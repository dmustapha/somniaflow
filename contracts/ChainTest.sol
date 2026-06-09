// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// [ASSUMED] — createRequest-from-handleResponse is the critical unverified assumption
// This contract is the Day 1 proof. Deploy it, call start(), wait for two callbacks.

interface ISomniaPlatform {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);
}

interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata jsonPath, uint8 decimals) external;
}

struct Response    { uint256 agentId; bytes data; }
enum ResponseStatus { Success, Timeout, Error }
struct Request    { uint256 agentId; address callbackAddress; bytes4 callbackSelector; bytes payload; }

contract ChainTest {
    ISomniaPlatform public constant PLATFORM =
        ISomniaPlatform(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776); // [VERIFIED]

    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713; // [VERIFIED]

    // Public state — read after execution to confirm pass/fail
    uint256 public step1RequestId;
    uint256 public step2RequestId;
    bool    public step2Dispatched;
    bool    public step2Completed;
    string  public step1Result;
    string  public step2Result;

    // [VERIFIED] — handleResponse signature from Somnia developer docs
    // Call start() with 0.4 STT minimum to fund both steps
    function start() external payable {
        require(msg.value >= 0.3 ether, "ChainTest: send >= 0.3 STT for two steps");

        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coinpaprika.com/v1/tickers/eth-ethereum",
            "quotes.USD.price",
            uint8(2)
        );

        // Use half the balance for step 1; keep rest for step 2
        uint256 step1Deposit = msg.value / 2;
        step1RequestId = PLATFORM.createRequest{value: step1Deposit}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector, // [VERIFIED] — callback registration pattern
            payload
        );
    }

    // [VERIFIED] — called by platform after agent fulfills request
    // [ASSUMED] — platform provides enough gas to dispatch a second createRequest from here
    function handleResponse(
        uint256        requestId,
        Response[]     memory responses,
        ResponseStatus status,
        Request        memory
    ) external {
        require(msg.sender == address(PLATFORM), "ChainTest: only platform");

        if (requestId == step1RequestId && !step2Dispatched) {
            // Record step 1 result
            if (responses.length > 0 && responses[0].data.length == 32) {
                uint256 price = abi.decode(responses[0].data, (uint256));
                step1Result = _uint256ToString(price);
            }

            // THE CRITICAL TEST: dispatch step 2 from within handleResponse
            bytes memory payload2 = abi.encodeWithSelector(
                IJsonApiAgent.fetchUint.selector,
                "https://api.coinpaprika.com/v1/tickers/eth-ethereum",
                "quotes.USD.volume_24h",
                uint8(0)
            );

            uint256 step2Deposit = address(this).balance;
            require(step2Deposit > 0, "ChainTest: no balance for step 2");

            step2RequestId = PLATFORM.createRequest{value: step2Deposit}(
                JSON_API_AGENT_ID,
                address(this),
                this.handleResponse.selector,
                payload2
            );
            step2Dispatched = true;

        } else if (requestId == step2RequestId && step2Dispatched) {
            if (responses.length > 0 && responses[0].data.length == 32) {
                uint256 volume = abi.decode(responses[0].data, (uint256));
                step2Result = _uint256ToString(volume);
            }
            step2Completed = true;
        }
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

    receive() external payable {}
}
