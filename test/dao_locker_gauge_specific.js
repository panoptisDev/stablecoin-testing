const {BigNumber} = require("ethers");
const {time, expectRevert} = require("@openzeppelin/test-helpers");
const {ethers} = require("hardhat");
const {toWei, fromWei, toBN} = web3.utils;
const {GetMockToken} = require("./Utils/GetMockConfig");
const {GetRusdAndTra} = require("./Utils/GetStableConfig");
const GAS = {gasLimit: "9550000"};

describe('Dao Locker Supplement', function () {
    const ONE_DAT_DURATION = 86400;

    async function getGaugesInBoost(poolAddress, approveNumber = toWei("100")) {
        const Gauge = await ethers.getContractFactory("Gauge");
        gaugeAddress = await boost.gauges(poolAddress.address);
        gauge = await Gauge.attach(gaugeAddress);
        await poolAddress.approve(gauge.address, approveNumber);
        return gauge;
    }

    beforeEach(async function () {
        [owner, dev] = await ethers.getSigners();
        [rusd, tra, , checkOpera] = await GetRusdAndTra();
        await rusd.transfer(dev.address, toWei("0.5"));
        await tra.transfer(dev.address, toWei("0.5"));

        [usdc] = await GetMockToken(1, [owner, dev], toWei("1"));

        const Locker = await ethers.getContractFactory("Locker");
        locker = await Locker.deploy(checkOpera.address, tra.address, ONE_DAT_DURATION);

        await tra.approve(locker.address, toWei("0.5"));
        await tra.connect(dev).approve(locker.address, toWei("0.5"));

        const GaugeFactory = await ethers.getContractFactory("GaugeFactory");
        gaugeFactory = await GaugeFactory.deploy(checkOpera.address);

        startBlock = await time.latestBlock();
        initStartBlock = parseInt(startBlock);

        const Boost = await ethers.getContractFactory("Boost");
        boost = await Boost.deploy(
            checkOpera.address,
            locker.address,
            gaugeFactory.address,
            tra.address,
            10000,
            parseInt(initStartBlock),
            10
        );

        const GaugeController = await ethers.getContractFactory("GaugeController");
        gaugeController = await GaugeController.deploy(
            checkOpera.address,
            boost.address,
            locker.address,
            ONE_DAT_DURATION
        );

        await tra.addPool(boost.address);
        // Create a gauge pool
        await boost.createGauge(usdc.address, 100000, false);
        await boost.addController(gaugeController.address); // Vote
        gauge = await getGaugesInBoost(usdc);
    });

    it('Two user,first deposit and transfer and second withdrawToken', async function () {
        await locker.createLock(toWei("0.5"), ONE_DAT_DURATION);
        tokenId = await locker.tokenId();

        initBalanceOfGuarantee = await usdc.balanceOf(owner.address);
        await gauge.deposit(toWei("0.5"));
        expect(await usdc.balanceOf(owner.address)).to.be.eq(BigNumber.from(initBalanceOfGuarantee).sub(BigNumber.from(toWei("0.5"))));
        await locker.transferFrom(owner.address, dev.address, tokenId);
        await gauge.connect(dev).withdrawToken(0);
        await expectRevert(gauge.connect(dev).withdrawToken(toWei("1.5")), "withdrawSwap: not good");
        await gauge.withdrawToken(toWei("0.5"));
        expect(await usdc.balanceOf(owner.address)).to.be.eq(initBalanceOfGuarantee);
    });

    it('Observe the voting effect', async function () {
        await locker.createLock(toWei("0.5"), ONE_DAT_DURATION);
        tokenId = await locker.tokenId();
        await locker.connect(dev).createLock(toWei("0.5"), ONE_DAT_DURATION);
        seTokenId = await locker.tokenId();

        await gauge.deposit(toWei("0.5"));
        await usdc.connect(dev).approve(gauge.address, toWei("1"));
        await gauge.connect(dev).deposit(toWei("0.5"));

        expect(parseInt(await time.latestBlock())).to.be.gt(initStartBlock);
        initOwnerBalance = await tra.balanceOf(owner.address);
        expect(await tra.balanceOf(dev.address)).to.be.eq(0);
        await gaugeController.addPool(usdc.address);
        await locker.addBoosts(gaugeController.address);
        await gaugeController.vote(tokenId, usdc.address);
        let pendingValue = await gauge.pendingMax(owner.address);
        await gauge.getReward(owner.address);
        await gauge.connect(dev).getReward(dev.address);
        expect(BigNumber.from(pendingValue)).to.be.gt(await tra.balanceOf(dev.address));
    });

    it('Observe the acceleration effect', async function () {
        await locker.createLock(toWei("0.5"), ONE_DAT_DURATION);
        tokenId = await locker.tokenId();
        await locker.connect(dev).createLock(toWei("0.5"), ONE_DAT_DURATION);
        seTokenId = await locker.tokenId();

        await gauge.deposit(toWei("0.5"));
        await usdc.connect(dev).approve(gauge.address, toWei("1"));
        await gauge.connect(dev).deposit(toWei("0.5"));

        expect(parseInt(await time.latestBlock())).to.be.gt(initStartBlock);
        initOwnerBalance = await tra.balanceOf(owner.address);
        expect(await tra.balanceOf(dev.address)).to.be.eq(0);
        await locker.addBoosts(boost.address);
        await boost.vote(tokenId, [usdc.address], [toWei("1")]);
        await boost.massUpdatePools();
        let pendingValue = await gauge.pendingMax(owner.address);
        await gauge.getReward(owner.address);
        await gauge.connect(dev).getReward(dev.address);
        expect(BigNumber.from(pendingValue)).to.be.gt(await tra.balanceOf(dev.address));
    });
});