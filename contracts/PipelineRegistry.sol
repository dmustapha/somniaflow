// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// =============================================================================
// EXTERNAL INTERFACES
// =============================================================================

// [VERIFIED] — Somnia Platform contract confirmed at 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
interface ISomniaPlatform {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256 reserveFloor);
}

// [VERIFIED on-chain Day 1] — actual selector 0xd0683905 decoded from Shannon event logs
// Real signature: message-array format (OpenAI-style), NOT the single-string format in dev.to docs
// roles: ["system","user"], contents: [systemPrompt, userPrompt], empty[], empty[], bool, uint256
interface ILLMAgent {
    function inferString(
        string[] calldata roles,
        string[] calldata contents,
        string[] calldata toolDefs,
        string[] calldata toolResults,
        bool streaming,
        uint256 maxTokens
    ) external;
}

// [VERIFIED] — fetchUint confirmed from Somnia docs
interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata jsonPath, uint8 decimals) external;
    function fetchString(string calldata url, string calldata jsonPath) external;
}

// [ASSUMED] — LLM Parse Website selector follows same encoding pattern as ILLMAgent.inferString
// [CRITIQUE E-5] — added to support agentType=2 in _buildPayload(); exercises all 3 Somnia agent types
interface ILLMParseWebsite {
    function parseWebsite(
        string calldata url,
        string calldata extractionPrompt,
        string calldata systemPrompt,
        bool streaming
    ) external;
}

// =============================================================================
// SOMNIA PLATFORM TYPES — [VERIFIED] from Somnia developer docs
// =============================================================================

struct Response {
    uint256 agentId;
    bytes data;
}

enum ResponseStatus { Success, Timeout, Error }

struct Request {
    uint256 agentId;
    address callbackAddress;
    bytes4 callbackSelector;
    bytes payload;
}

// =============================================================================
// PIPELINEREGISTRY — SDK-RELAY VARIANT
// Day 1 finding: createRequest() cannot be called from within handleResponse()
// on Shannon testnet. This relay variant emits StepCompleted and returns;
// relay-coordinator.ts calls dispatchNext(pipelineId) to advance the FSM.
// =============================================================================

contract PipelineRegistry {

    // -------------------------------------------------------------------------
    // Constants — [VERIFIED] unless marked otherwise
    // -------------------------------------------------------------------------

    ISomniaPlatform public constant PLATFORM =
        ISomniaPlatform(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776); // [VERIFIED]

    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;  // [VERIFIED] from TX log topic[2]
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384; // [VERIFIED] from on-chain event (0xb24ac1afbcefc708, deposit=0.07 STT, 2052-byte payload)

    // [ASSUMED] — pricing from Somnia docs estimates
    uint256 public constant JSON_API_PRICE_PER_AGENT  = 0.03 ether;
    uint256 public constant LLM_PRICE_PER_AGENT       = 0.07 ether;
    uint256 public constant LLM_PARSE_PRICE_PER_AGENT = 0.10 ether;
    uint256 public constant DEFAULT_SUBCOMMITTEE      = 3;

    uint8 public constant AGENT_TYPE_JSON_API  = 0;
    uint8 public constant AGENT_TYPE_LLM       = 1;
    uint8 public constant AGENT_TYPE_PARSE_WEB = 2; // [CRITIQUE E-5]
    uint8 public constant AGENT_TYPE_EXTERNAL  = 3;

    // [VERIFIED] — _containsExecute() searches for this exact string
    bytes private constant EXECUTE_NEEDLE = bytes("DECISION: EXECUTE");

    string private constant SYSTEM_PROMPT =
        "You are a data processing agent. Analyze the input and respond with EXACTLY:\n"
        "DECISION: EXECUTE\n"
        "or\n"
        "DECISION: SKIP\n"
        "Then on separate lines:\n"
        "REASONING: [2-3 sentences explaining your analysis]\n"
        "CONFIDENCE: [HIGH|MEDIUM|LOW]\n"
        "DECISION must appear on the first line.";

    // -------------------------------------------------------------------------
    // Storage types
    // -------------------------------------------------------------------------

    struct PipelineStep {
        uint8   agentType;
        string  inputTemplate;
        bool    conditionalOnPrev;
        uint8   maxRetries;
    }

    enum StepStatus     { Idle, Pending, Complete, Failed, Retrying, Skipped }
    enum PipelineStatus { Idle, Running, Complete, Failed }

    struct Pipeline {
        address         owner;
        PipelineStep[]  steps;
        StepStatus[]    stepStatuses;
        string[]        stepResults;
        uint256         pendingRequestId;
        uint256         activePipelineStep;
        uint8[]         retryCounts;
        bool            active;
        uint256         sttBalance;
        PipelineStatus  status;
    }

    struct PipelineStepInput {
        uint8  agentType;
        string inputTemplate;
        bool   conditionalOnPrev;
        uint8  maxRetries;
    }

    struct PipelineStateView {
        uint256        pipelineId;
        PipelineStatus status;
        uint256        activeStep;
        StepStatus[]   stepStatuses;
        uint256        sttBalance;
        string[]       stepResults;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address private _relayAddress;

    uint256 public pipelineCount;
    mapping(uint256 => Pipeline) private _pipelines;
    mapping(uint256 => uint256)  private _requestToPipeline;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event PipelineRegistered(uint256 indexed pipelineId, address indexed owner, uint256 stepCount);
    event PipelineFunded    (uint256 indexed pipelineId, uint256 amount);
    event PipelineStarted   (uint256 indexed pipelineId);
    event StepDispatched    (uint256 indexed pipelineId, uint256 step, uint8 agentType, uint256 requestId);
    event StepCostEstimated (uint256 indexed pipelineId, uint256 step, uint256 depositWei);
    event StepCompleted     (uint256 indexed pipelineId, uint256 step, string result);
    event StepSkipped       (uint256 indexed pipelineId, uint256 step);
    event StepRetrying      (uint256 indexed pipelineId, uint256 step, uint8 attempt);
    event PipelineComplete  (uint256 indexed pipelineId);
    event PipelineFailed    (uint256 indexed pipelineId, uint256 step, string reason);

    // -------------------------------------------------------------------------
    // Constructor — SDK-relay variant: LLM_INFERENCE_AGENT_ID is a constant (verified Day 1)
    // Only needs relayAddress since agent IDs are now baked in as constants.
    // -------------------------------------------------------------------------

    constructor(address relayAddress) {
        _relayAddress = relayAddress;
    }

    // -------------------------------------------------------------------------
    // External — pipeline lifecycle
    // -------------------------------------------------------------------------

    function registerPipeline(PipelineStepInput[] calldata steps)
        external
        payable
        returns (uint256 pipelineId)
    {
        require(steps.length > 0 && steps.length <= 10, "PipelineRegistry: 1-10 steps");
        pipelineId = ++pipelineCount;

        Pipeline storage pipe = _pipelines[pipelineId];
        pipe.owner      = msg.sender;
        pipe.status     = PipelineStatus.Idle;
        pipe.active     = false;
        pipe.sttBalance = msg.value;

        for (uint256 i = 0; i < steps.length; i++) {
            pipe.steps.push(PipelineStep({
                agentType:         steps[i].agentType,
                inputTemplate:     steps[i].inputTemplate,
                conditionalOnPrev: steps[i].conditionalOnPrev,
                maxRetries:        steps[i].maxRetries
            }));
            pipe.stepStatuses.push(StepStatus.Idle);
            pipe.stepResults.push("");
            pipe.retryCounts.push(0);
        }

        emit PipelineRegistered(pipelineId, msg.sender, steps.length);
        if (msg.value > 0) emit PipelineFunded(pipelineId, msg.value);
    }

    function fundPipeline(uint256 pipelineId) external payable {
        require(msg.value > 0, "PipelineRegistry: zero value");
        _pipelines[pipelineId].sttBalance += msg.value;
        emit PipelineFunded(pipelineId, msg.value);
    }

    function triggerPipeline(uint256 pipelineId) external {
        Pipeline storage pipe = _pipelines[pipelineId];
        require(pipe.owner != address(0), "PipelineRegistry: unknown pipeline");
        require(!pipe.active,             "PipelineRegistry: already running");

        pipe.active             = true;
        pipe.status             = PipelineStatus.Running;
        pipe.activePipelineStep = 0;

        for (uint256 i = 0; i < pipe.steps.length; i++) {
            pipe.stepStatuses[i] = StepStatus.Idle;
            pipe.stepResults[i]  = "";
            pipe.retryCounts[i]  = 0;
        }

        emit PipelineStarted(pipelineId);
        _dispatchStep(pipelineId, 0);
    }

    // [VERIFIED] — signature confirmed from Somnia developer docs
    // SDK-relay variant: records result + emits StepCompleted, then RETURNS.
    // relay-coordinator.ts observes StepCompleted and calls dispatchNext().
    function handleResponse(
        uint256        requestId,
        Response[]     memory responses,
        ResponseStatus status,
        Request        memory /* details */
    ) external {
        require(msg.sender == address(PLATFORM), "PipelineRegistry: only platform");

        uint256 pipelineId = _requestToPipeline[requestId];
        require(pipelineId != 0, "PipelineRegistry: unknown requestId");

        Pipeline storage pipe = _pipelines[pipelineId];
        require(pipe.pendingRequestId == requestId, "PipelineRegistry: stale callback");
        require(pipe.active,                        "PipelineRegistry: not active");

        uint256 step = pipe.activePipelineStep;

        if (status == ResponseStatus.Timeout || status == ResponseStatus.Error) {
            if (pipe.retryCounts[step] < pipe.steps[step].maxRetries) {
                pipe.retryCounts[step]++;
                pipe.stepStatuses[step] = StepStatus.Retrying;
                emit StepRetrying(pipelineId, step, pipe.retryCounts[step]);
                pipe.pendingRequestId = 0; // relay re-dispatches via dispatchNext()
                return;
            }
            pipe.stepStatuses[step] = StepStatus.Failed;
            pipe.active             = false;
            pipe.status             = PipelineStatus.Failed;
            emit PipelineFailed(pipelineId, step, "max retries exceeded");
            return;
        }

        string memory result = _decodeResponse(responses, pipe.steps[step].agentType);

        pipe.stepResults[step]  = result;
        pipe.stepStatuses[step] = StepStatus.Complete;
        emit StepCompleted(pipelineId, step, result);
        // relay-coordinator.ts observes this event and calls dispatchNext()
    }

    // SDK-relay entry point: called by relay-coordinator.ts or pipeline owner
    function dispatchNext(uint256 pipelineId) external {
        Pipeline storage pipe = _pipelines[pipelineId];
        require(
            msg.sender == pipe.owner || msg.sender == _relayAddress,
            "PipelineRegistry: not owner or relay"
        );
        require(pipe.active, "PipelineRegistry: not active");
        require(
            pipe.stepStatuses[pipe.activePipelineStep] != StepStatus.Pending,
            "PipelineRegistry: step still pending"
        );
        _advancePipeline(pipelineId, pipe.activePipelineStep);
    }

    /**
     * @notice Relay-injected step result. Bypasses Shannon Platform callback.
     *         Called by _relayAddress after executing the agent step off-chain.
     *         Injects the result directly and advances the pipeline FSM.
     * @param requestId  The requestId emitted in the StepDispatched event
     * @param result     String result from the agent execution (price, LLM output, etc.)
     */
    function ownerHandleResponse(uint256 requestId, string calldata result) external {
        require(msg.sender == _relayAddress, "PipelineRegistry: not relay");

        uint256 pipelineId = _requestToPipeline[requestId];
        require(pipelineId != 0, "PipelineRegistry: unknown requestId");

        Pipeline storage pipe = _pipelines[pipelineId];
        require(pipe.pendingRequestId == requestId, "PipelineRegistry: stale requestId");
        require(pipe.active, "PipelineRegistry: not active");

        uint256 step = pipe.activePipelineStep;

        pipe.stepResults[step]  = result;
        pipe.stepStatuses[step] = StepStatus.Complete;
        pipe.pendingRequestId   = 0;

        emit StepCompleted(pipelineId, step, result);

        // Advance pipeline — next _dispatchStep will emit StepDispatched for relay to pick up
        _advancePipeline(pipelineId, step);
    }

    /**
     * @notice Emergency reset for a stuck pipeline (status=Running but no pending callback).
     *         Only callable by _relayAddress. Resets FSM to Idle so pipeline can be re-triggered.
     */
    function emergencyReset(uint256 pipelineId) external {
        require(msg.sender == _relayAddress, "PipelineRegistry: not relay");
        Pipeline storage pipe = _pipelines[pipelineId];
        require(pipe.status == PipelineStatus.Running, "PipelineRegistry: not running");
        pipe.active           = false;
        pipe.status           = PipelineStatus.Idle;
        pipe.pendingRequestId = 0;
    }

    // -------------------------------------------------------------------------
    // External — reads
    // -------------------------------------------------------------------------

    function getPipelineState(uint256 pipelineId)
        external
        view
        returns (PipelineStateView memory)
    {
        Pipeline storage pipe = _pipelines[pipelineId];
        return PipelineStateView({
            pipelineId:   pipelineId,
            status:       pipe.status,
            activeStep:   pipe.activePipelineStep,
            stepStatuses: pipe.stepStatuses,
            sttBalance:   pipe.sttBalance,
            stepResults:  pipe.stepResults
        });
    }

    function getPipelineStepResult(uint256 pipelineId, uint256 stepIndex)
        external
        view
        returns (string memory result, StepStatus stepStatus)
    {
        Pipeline storage pipe = _pipelines[pipelineId];
        require(stepIndex < pipe.steps.length, "PipelineRegistry: out of range");
        return (pipe.stepResults[stepIndex], pipe.stepStatuses[stepIndex]);
    }

    /**
     * @notice Returns the step definitions for a pipeline.
     *         Used by the relay coordinator to get inputTemplate for each step.
     */
    function getPipelineSteps(uint256 pipelineId)
        external
        view
        returns (PipelineStep[] memory)
    {
        return _pipelines[pipelineId].steps;
    }

    /**
     * @notice Returns pipeline name and step count for UI display.
     */
    function getPipelineMeta(uint256 pipelineId)
        external
        view
        returns (address owner, uint256 stepCount, bool active, PipelineStatus status)
    {
        Pipeline storage pipe = _pipelines[pipelineId];
        return (pipe.owner, pipe.steps.length, pipe.active, pipe.status);
    }

    function withdrawBalance(uint256 pipelineId) external {
        Pipeline storage pipe = _pipelines[pipelineId];
        require(pipe.owner == msg.sender, "PipelineRegistry: not owner");
        require(!pipe.active,             "PipelineRegistry: pipeline active");
        uint256 amount  = pipe.sttBalance;
        pipe.sttBalance = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "PipelineRegistry: transfer failed");
    }

    // -------------------------------------------------------------------------
    // Internal — FSM
    // -------------------------------------------------------------------------

    function _advancePipeline(uint256 pipelineId, uint256 completedStep) internal {
        Pipeline storage pipe = _pipelines[pipelineId];
        uint256 nextStep      = completedStep + 1;

        if (nextStep >= pipe.steps.length) {
            pipe.active = false;
            pipe.status = PipelineStatus.Complete;
            emit PipelineComplete(pipelineId);
            return;
        }

        if (pipe.steps[nextStep].conditionalOnPrev) {
            if (!_containsExecute(pipe.stepResults[completedStep])) {
                for (uint256 i = nextStep; i < pipe.steps.length; i++) {
                    pipe.stepStatuses[i] = StepStatus.Skipped;
                    emit StepSkipped(pipelineId, i);
                }
                pipe.active = false;
                pipe.status = PipelineStatus.Complete;
                emit PipelineComplete(pipelineId);
                return;
            }
        }

        pipe.activePipelineStep = nextStep;
        _dispatchStep(pipelineId, nextStep);
    }

    function _dispatchStep(uint256 pipelineId, uint256 stepIndex) internal {
        Pipeline storage pipe = _pipelines[pipelineId];
        PipelineStep storage step = pipe.steps[stepIndex];

        // External agents bypass Somnia Platform entirely — relay handles HTTP execution
        if (step.agentType == AGENT_TYPE_EXTERNAL) {
            uint256 fakeRequestId = uint256(keccak256(
                abi.encodePacked(pipelineId, stepIndex, block.number)
            ));
            _requestToPipeline[fakeRequestId] = pipelineId;
            pipe.pendingRequestId             = fakeRequestId;
            pipe.stepStatuses[stepIndex]      = StepStatus.Pending;
            emit StepCostEstimated(pipelineId, stepIndex, 0);
            emit StepDispatched(pipelineId, stepIndex, step.agentType, fakeRequestId);
            return;
        }

        string memory prevResult = stepIndex > 0 ? pipe.stepResults[stepIndex - 1] : "";
        string memory input      = _interpolate(step.inputTemplate, prevResult);
        bytes  memory payload    = _buildPayload(step.agentType, input);
        uint256 deposit          = _calcDeposit(step.agentType);

        require(pipe.sttBalance >= deposit, "PipelineRegistry: insufficient STT");
        pipe.sttBalance -= deposit;

        emit StepCostEstimated(pipelineId, stepIndex, deposit);

        uint256 agentId;
        if (step.agentType == AGENT_TYPE_LLM || step.agentType == AGENT_TYPE_PARSE_WEB) {
            agentId = LLM_INFERENCE_AGENT_ID;
        } else {
            agentId = JSON_API_AGENT_ID;
        }

        uint256 requestId = PLATFORM.createRequest{value: deposit}(
            agentId,
            address(this),
            this.handleResponse.selector,
            payload
        );

        _requestToPipeline[requestId] = pipelineId;
        pipe.pendingRequestId         = requestId;
        pipe.stepStatuses[stepIndex]  = StepStatus.Pending;

        emit StepDispatched(pipelineId, stepIndex, step.agentType, requestId);
    }

    function _containsExecute(string memory result) internal pure returns (bool) {
        bytes memory haystack = bytes(result);
        uint256 needleLen     = EXECUTE_NEEDLE.length;
        if (haystack.length < needleLen) return false;
        uint256 limit = haystack.length - needleLen;
        for (uint256 i = 0; i <= limit; i++) {
            bool found = true;
            for (uint256 j = 0; j < needleLen; j++) {
                if (haystack[i + j] != EXECUTE_NEEDLE[j]) { found = false; break; }
            }
            if (found) return true;
        }
        return false;
    }

    function _interpolate(string memory template, string memory value)
        internal
        pure
        returns (string memory)
    {
        bytes memory t           = bytes(template);
        bytes memory placeholder = bytes("{prevResult}");
        uint256 pLen             = placeholder.length;

        if (t.length < pLen) return template;

        uint256 limit = t.length - pLen;
        for (uint256 i = 0; i <= limit; i++) {
            bool found = true;
            for (uint256 j = 0; j < pLen; j++) {
                if (t[i + j] != placeholder[j]) { found = false; break; }
            }
            if (found) {
                bytes memory prefix = new bytes(i);
                bytes memory suffix = new bytes(t.length - i - pLen);
                bytes memory v      = bytes(value);
                for (uint256 k = 0; k < i; k++)              prefix[k] = t[k];
                for (uint256 k = 0; k < suffix.length; k++)  suffix[k] = t[i + pLen + k];
                return string(abi.encodePacked(prefix, v, suffix));
            }
        }
        return template;
    }

    function _calcDeposit(uint8 agentType) internal view returns (uint256) {
        if (agentType == AGENT_TYPE_EXTERNAL) return 0; // External agents cost zero STT
        uint256 reserveFloor;
        try PLATFORM.getRequestDeposit() returns (uint256 floor) {
            reserveFloor = floor;
        } catch {
            reserveFloor = 0.01 ether; // 0.01 STT fallback if Platform reverts
        }
        uint256 pricePerAgent;
        if (agentType == AGENT_TYPE_LLM)            pricePerAgent = LLM_PRICE_PER_AGENT;
        else if (agentType == AGENT_TYPE_PARSE_WEB) pricePerAgent = LLM_PARSE_PRICE_PER_AGENT;
        else                                        pricePerAgent = JSON_API_PRICE_PER_AGENT;
        return (reserveFloor + pricePerAgent * DEFAULT_SUBCOMMITTEE) * 12 / 10;
    }

    function _buildPayload(uint8 agentType, string memory input)
        internal
        pure
        returns (bytes memory)
    {
        if (agentType == AGENT_TYPE_LLM) {
            // [VERIFIED Day 1] — actual on-chain format: message-array (OpenAI-style)
            // selector 0xd0683905 decoded from Shannon event logs; roles+contents parallel arrays
            string[] memory roles = new string[](2);
            string[] memory contents = new string[](2);
            string[] memory empty = new string[](0);
            roles[0] = "system";
            roles[1] = "user";
            contents[0] = SYSTEM_PROMPT;
            contents[1] = input;
            return abi.encodeWithSelector(
                ILLMAgent.inferString.selector,
                roles,
                contents,
                empty,
                empty,
                false,
                uint256(0)
            );
        }
        if (agentType == AGENT_TYPE_PARSE_WEB) {
            (string memory url, string memory extractionPrompt,) = _parseJsonApiInput(input);
            return abi.encodeWithSelector(
                ILLMParseWebsite.parseWebsite.selector,
                url,
                extractionPrompt,
                "Extract and summarize the key information as plain text.",
                false
            );
        }
        (string memory url, string memory jsonPath, uint8 decimals) = _parseJsonApiInput(input);
        return abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            url,
            jsonPath,
            decimals
        );
    }

    function _decodeResponse(Response[] memory responses, uint8 agentType)
        internal
        pure
        returns (string memory)
    {
        if (responses.length == 0 || responses[0].data.length == 0) return "";
        bytes memory data = responses[0].data;
        if (agentType == AGENT_TYPE_LLM) return string(data);
        if (data.length == 32) {
            uint256 num = abi.decode(data, (uint256));
            return _uint256ToString(num);
        }
        return string(data);
    }

    function _parseJsonApiInput(string memory input)
        internal
        pure
        returns (string memory url, string memory jsonPath, uint8 decimals)
    {
        bytes memory b     = bytes(input);
        uint256 first  = type(uint256).max;
        uint256 second = type(uint256).max;

        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == "|") {
                if (first == type(uint256).max) { first  = i; }
                else                            { second = i; break; }
            }
        }

        require(
            first != type(uint256).max && second != type(uint256).max,
            "PipelineRegistry: invalid JSON_API input - expected url|path|decimals"
        );

        bytes memory urlBytes  = new bytes(first);
        bytes memory pathBytes = new bytes(second - first - 1);
        bytes memory decBytes  = new bytes(b.length - second - 1);

        for (uint256 i = 0; i < first; i++)            urlBytes[i]  = b[i];
        for (uint256 i = 0; i < pathBytes.length; i++) pathBytes[i] = b[first + 1 + i];
        for (uint256 i = 0; i < decBytes.length; i++)  decBytes[i]  = b[second + 1 + i];

        url      = string(urlBytes);
        jsonPath = string(pathBytes);
        decimals = uint8(_parseUint(string(decBytes)));
    }

    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _parseUint(string memory s) internal pure returns (uint256 result) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            require(b[i] >= "0" && b[i] <= "9", "PipelineRegistry: non-numeric decimals");
            result = result * 10 + (uint8(b[i]) - 48);
        }
    }

    receive() external payable {}
}
