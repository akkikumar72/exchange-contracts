/*
 * SPDX-License-Identifier: GPLv3
 * solhint-disable not-rely-on-time
 *
 * Sunshine and Rainbows: Liquidity Pool Token Compound
 * Copyright (C) 2022 - shung <twitter:shunduquar>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
pragma solidity ^0.8.0;

import "./SunshineAndRainbowsCompound.sol";

import "../pangolin-core/interfaces/IPangolinPair.sol";
import "../pangolin-periphery/interfaces/IPangolinRouter.sol";

/**
 * @title Sunshine and Rainbows Extension: LP Stake Compound
 * @notice An extension to `SunshineAndRainbows` that implements locked-stake
 * harvesting feature when the staking tokens is a pool token and the reward
 * token is one of the tokens in the LP pair
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsCompoundLP is SunshineAndRainbowsCompound {
    using SafeERC20 for IERC20;

    IPangolinRouter public immutable router;

    IERC20 internal _pairToken;

    bool internal _rewardTokenIs0;

    /**
     * @notice Constructs a new SunshineAndRainbows staking contract with
     * locked-stake harvesting feature
     * @param newStakingToken Contract address of the staking token
     * @param newRewardRegulator Contract address of the reward regulator which
     * distributes reward tokens
     * @param newRouter Address of the router that will be used to deposit
     */
    constructor(
        address newStakingToken,
        address newRewardRegulator,
        address newRouter
    ) SunshineAndRainbows(newStakingToken, newRewardRegulator) {
        require(newRouter != address(0), "SAR::Constructor: zero address");
        router = IPangolinRouter(newRouter);

        IPangolinPair pair = IPangolinPair(newStakingToken);
        IERC20 newRewardToken = IRewardRegulator(newRewardRegulator)
            .rewardToken();

        if (pair.token0() == address(newRewardToken)) {
            _pairToken = IERC20(pair.token1());
            _rewardTokenIs0 = true;
        } else if (pair.token1() == address(newRewardToken)) {
            _pairToken = IERC20(pair.token0());
        } else {
            revert("SAR::Constructor: Reward token not part of LP token");
        }

        newRewardToken.approve(newRouter, type(uint).max);
        _pairToken.approve(newRouter, type(uint).max);
    }

    /**
     * @notice Creates a new position with the rewards of the given position
     * @dev New position is considered locked, and it cannot be withdrawn until
     * the parent position is updated after the creation of the new position.
     * The new position also requires equal amount of pair token to the reward
     * amount
     * @param posId ID of the parent position whose rewards are harvested
     * @param maxPairAmount The max amount of pair token that can be paired
     * with rewards
     */
    function compound(uint posId, uint maxPairAmount) external {
        // update the state variables that govern the reward distribution
        _updateRewardVariables();

        // create a new position
        uint childPosId = positions.length;

        // record parent-child relation to lock the child position
        children[childPosId] = Child(posId, block.timestamp);

        // harvest parent position and add liquidity with that
        uint amount = _addLiquidity(_harvestWithDebt(posId), maxPairAmount);

        // stake parent position rewards to child position
        _open(amount, address(this));

        emit Compounded(posId, childPosId, amount);
    }

    /**
     * @notice Adds liquidity with the harvested reward & supplied pair
     * @param reward The amount of reward tokens harvested
     * @param maxPairAmount The max amount of pair token that can be paired
     * with reward
     */
    function _addLiquidity(uint reward, uint maxPairAmount)
        private
        returns (uint)
    {
        require(reward != 0, "SAR::_addLiquidity: no reward");
        IPangolinPair pair = IPangolinPair(address(stakingToken));
        (uint reserve0, uint reserve1, ) = pair.getReserves();
        require(
            reserve0 > 1000 && reserve1 > 1000,
            "SAR::_addLiquidity: low reserves"
        );

        uint pairAmount = _rewardTokenIs0
            ? (reward * reserve1) / reserve0
            : (reward * reserve0) / reserve1;

        require(
            maxPairAmount >= pairAmount,
            "SAR::_addLiquidity: high slippage"
        );

        _pairToken.safeTransferFrom(msg.sender, address(this), pairAmount);

        (, , uint amount) = router.addLiquidity(
            address(rewardToken), // tokenA
            address(_pairToken), // tokenB
            reward, // amountADesired
            pairAmount, // amountBDesired
            1, // amountAMin
            1, // amountBMin
            address(this), // to
            block.timestamp // deadline
        );

        return amount;
    }
}
