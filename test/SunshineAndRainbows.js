// test/SunshineAndRainbows.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

const DENOMINATOR = BigNumber.from("10000");
const ONE_DAY = BigNumber.from("86400");
const SUPPLY = ethers.utils.parseUnits("10000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const FUNDER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDER"));
const PRECISION = BigNumber.from("2").pow("256");
const UINT256_MAX = ethers.constants.MaxUint256;

function getRewards(duration) {
  return SUPPLY.div(ONE_DAY.mul("100")).mul(duration);
}

function updateRewardVariables(rewards, stakingDuration, sinceInit) {
  var idealPosition = rewards
    .mul(sinceInit)
    .mul(PRECISION.div(stakingDuration));
  var rewardsPerStakingDuration = rewards.mul(PRECISION.div(stakingDuration));

  return [idealPosition, rewardsPerStakingDuration];
}

// Start test block
describe("SunshineAndRainbows.sol", function () {
  before(async function () {
    // Get all signers
    this.signers = await ethers.getSigners();
    this.admin = this.signers[0];
    this.unauthorized = this.signers[1];

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Sunshine = await ethers.getContractFactory("SunshineAndRainbows");
    this.Regulator = await ethers.getContractFactory("RewardRegulatorFundable");
  });

  beforeEach(async function () {
    this.rewardToken = await this.Png.deploy(
      SUPPLY,
      SUPPLY,
      "REWARD",
      "Reward Token"
    );
    await this.rewardToken.deployed();

    this.stakingToken = await this.Png.deploy(
      SUPPLY,
      SUPPLY,
      "STAKING",
      "Staking Token"
    );
    await this.stakingToken.deployed();

    this.regulator = await this.Regulator.deploy(this.rewardToken.address);
    await this.regulator.deployed();

    this.sunshine = await this.Sunshine.deploy(
      this.stakingToken.address,
      this.regulator.address
    );
    await this.sunshine.deployed();

    await this.rewardToken.transfer(this.regulator.address, SUPPLY);
    await this.stakingToken.approve(this.sunshine.address, SUPPLY);

    await this.regulator.grantRole(FUNDER_ROLE, this.admin.address);
    await this.regulator.setRecipients([this.sunshine.address], ["1"]);
    await this.regulator.setRewardsDuration(ONE_DAY.mul(100));
    await this.regulator.notifyRewardAmount(SUPPLY);

    var blockNumber = await ethers.provider.getBlockNumber();
    this.notifyRewardTime = (
      await ethers.provider.getBlock(blockNumber)
    ).timestamp;
  });

  // Test cases

  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: stakingToken", async function () {
      expect(await this.sunshine.stakingToken()).to.equal(
        this.stakingToken.address
      );
    });

    it("arg 2: rewardRegulator", async function () {
      expect(await this.sunshine.rewardRegulator()).to.equal(
        this.regulator.address
      );
    });

    it("default: totalSupply", async function () {
      expect(await this.sunshine.totalSupply()).to.equal("0");
    });

    it("default: rewardToken", async function () {
      expect(await this.sunshine.rewardToken()).to.equal(
        this.rewardToken.address
      );
    });

    it("default: initTime", async function () {
      expect(await this.sunshine.initTime()).to.equal("0");
    });

    it("default: sumOfEntryTimes", async function () {
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });
  });

  //////////////////////////////
  //     open
  //////////////////////////////
  describe("open", function () {
    it("stakes once", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.initTime()).to.equal(initTime);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(initTime)
      );

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.owner).to.equal(this.admin.address);
    });

    it("cannot stake zero", async function () {
      await expect(this.sunshine.open("0")).to.be.revertedWith(
        "SAR::_open: zero amount"
      );
    });

    it("stake twice and update reward variables", async function () {
      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.be.within(reward.sub("2"), reward);

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        reward
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.div("2").mul(initTime + lastUpdate)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        getRewards(lastUpdate - this.notifyRewardTime),
        SUPPLY.div("2").mul(interval),
        interval
      );

      var position = await this.sunshine.positions("1");

      expect(position.balance).to.equal(SUPPLY.div("2"));
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal(idealPosition);
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal(
        rewardsPerStakingDuration
      );
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });
  });

  //////////////////////////////
  //     close
  //////////////////////////////
  describe("close", function () {
    it("closes after staking", async function () {
      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.equal("0");

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(distributed).to.be.within(reward.sub("2"), reward);

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        remaining
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal("0"); // only balance is updated
      expect(position.lastUpdate).to.equal(initTime); // no need to update
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot do anything with closed position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: zero reward"
      );
      await expect(
        this.sunshine.withdraw("0", SUPPLY.div("2"))
      ).to.be.revertedWith("SAR::_withdraw: use `close()`");
      await expect(this.sunshine.close("0")).to.be.revertedWith(
        "SAR::_close: zero amount"
      );
      await expect(this.sunshine.multiClose(["0"])).to.be.revertedWith(
        "SAR::_close: zero amount"
      );
    });

    it("cannot close others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.close("0")).to.be.revertedWith(
        "SAR::_close: unauthorized"
      );
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("harvests after staking", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.harvest("0")).to.emit(
        this.sunshine,
        "Harvested"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        "0"
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(distributed).to.be.within(reward.sub("2"), reward);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.equal("0");

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        remaining
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(lastUpdate)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal(idealPosition);
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal(
        rewardsPerStakingDuration
      );
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot harvest from others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: unauthorized"
      );
    });

    it("cannot harvest zero", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");

      await expect(this.sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: zero reward"
      );
    });
  });

  //////////////////////////////
  //     multiClose
  //////////////////////////////
  describe("multiClose", function () {
    it("exits 10 positions", async function () {
      var arr = [];
      var blockNumber;
      var initTime;

      for (let i = 0; i < 10; i++) {
        await expect(this.sunshine.open(SUPPLY.div("10"))).to.emit(
          this.sunshine,
          "Opened"
        );
        if (i == 0) {
          blockNumber = await ethers.provider.getBlockNumber();
          initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;
        }
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
        arr.push(i);
      }

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );

      expect(await this.sunshine.multiClose(arr)).to.emit(
        this.sunshine,
        "Closed"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        "0"
      );
      expect(distributed).to.be.within(reward.sub("20"), reward);

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        remaining
      );

      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });
  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("withdraws half after staking", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY.div("2")
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY.div("2")
      );
      expect(distributed).to.be.within(
        reward.div("2").sub("2"),
        reward.div("2")
      );

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        remaining
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY.div("2"));
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.div("2").mul(initTime)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.be.within(remaining.sub("2"), remaining);

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY.div("2"));
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot withdraw from others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.withdraw("0", SUPPLY.div("2"))).to.be.revertedWith(
        "SAR::_withdraw: unauthorized"
      );
    });

    it("cannot withdraw zero", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", "0")).to.be.revertedWith(
        "SAR::_withdraw: zero amount"
      );
    });

    it("cannot withdraw more or equal to balance", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", SUPPLY)).to.be.revertedWith(
        "SAR::_withdraw: use `close()`"
      );
    });
  });
});

describe("FullMath.sol", function () {
  before(async function () {
    // get signers
    [this.admin, this.unauthorized] = await ethers.getSigners();

    // get contract factories
    this.FullMath = await ethers.getContractFactory(
      "contracts/sunshine-staking/FullMathTest.sol:FullMathTest"
    );
  });

  beforeEach(async function () {
    // deploy library tester
    this.math = await this.FullMath.deploy();
    await this.math.deployed();
  });

  // Test cases
  //
  describe("add(Uint512, Uint512)", function () {
    it("result fits 256bit", async function () {
      await this.math.add(["4129834010293", "0"], ["18989899999912838", "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("18994029833923131");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256bit", async function () {
      await this.math.add(["1", "0"], [UINT256_MAX, "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("0");
      expect(value.r1).to.equal("1");
    });
    it("result does not fit 256bit (complex values)", async function () {
      await this.math.add(
        ["18020731948", "987092"],
        [UINT256_MAX, "3810247001234987"]
      );
      var value = await this.math.testValue();
      expect(value.r0).to.equal("18020731947");
      expect(value.r1).to.equal("3810247002222080");
    });
  });

  describe("sub(Uint512, Uint512)", function () {
    it("result fits 256bit", async function () {
      await this.math.sub(["4129834010293", "0"], ["2938419", "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("4129831071874");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256bit (complex values)", async function () {
      await this.math.sub(["23948", "9328417097"], [UINT256_MAX, "239841"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("23949");
      expect(value.r1).to.equal("9328177255");
    });
    it("result fits 256bit (complex values)", async function () {
      await this.math.sub(["23948", "9328417097"], [UINT256_MAX, "9328417096"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("23949");
      expect(value.r1).to.equal("0");
    });
  });

  describe("mul(uint256, uint256)", function () {
    it("result is 0", async function () {
      await this.math.mul256("4129834010293", "0");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("0");
      expect(value.r1).to.equal("0");
    });
    it("result fits 256 bits", async function () {
      await this.math.mul256("23948", "308470113412317042317027089");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("7387242275998168529408164727372");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256 bits", async function () {
      await this.math.mul256(UINT256_MAX, "308470113412317042317027089");
      var value = await this.math.testValue();
      expect(value.r0).to.equal(
        "115792089237316195423570985008687907853269984665640255569344171690870812612847"
      );
      expect(value.r1).to.equal("308470113412317042317027088");
    });
  });

  describe("mul(Uint512, uint256)", function () {
    describe("arg 1 fits 256 bits", function () {
      it("multiplication by 0", async function () {
        await this.math.mul512(["4129834010293", "0"], "0");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("0");
        expect(value.r1).to.equal("0");
      });
      it("multiplication fits 256 bits", async function () {
        await this.math.mul512(["23948", "0"], "308470113412317042317027089");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("7387242275998168529408164727372");
        expect(value.r1).to.equal("0");
      });
      it("multiplication does not fit 256 bits", async function () {
        await this.math.mul512(
          [UINT256_MAX, "0"],
          "308470113412317042317027089"
        );
        var value = await this.math.testValue();
        expect(value.r0).to.equal(
          "115792089237316195423570985008687907853269984665640255569344171690870812612847"
        );
        expect(value.r1).to.equal("308470113412317042317027088");
      });
    });
    describe("arg 1 does not fit 256 bits", function () {
      it("multiplication by 0", async function () {
        await this.math.mul512(["4129834010293", "38"], "0");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("0");
        expect(value.r1).to.equal("0");
      });
      it("least significant multiplication fits 256 bits", async function () {
        await this.math.mul512(["23948", "4"], "308470113412317042317027089");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("7387242275998168529408164727372");
        expect(value.r1).to.equal("1233880453649268169268108356");
      });
      it("least significant multiplication does not fit 256 bits", async function () {
        await this.math.mul512(
          [UINT256_MAX, "92837"],
          "308470113412317042317027089"
        );
        var value = await this.math.testValue();
        expect(value.r0).to.equal(
          "115792089237316195423570985008687907853269984665640255569344171690870812612847"
        );
        expect(value.r1).to.equal("28637748388972689574628160888581");
      });
    });
  });
});
