// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

interface IVoteController {

    function totalWeight() external view returns (uint);

    function weights(address) external view returns (uint);
}
