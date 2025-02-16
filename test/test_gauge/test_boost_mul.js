const $ = require('../lib/common');
const {time} = require('@openzeppelin/test-helpers');
const {ethers} = require("hardhat");
const {expect} = require("chai");
const {toWei} = web3.utils;
const {Decimal} = require('decimal.js');
const {BigNumber} = require("ethers");

contract('BoostMul', () => {
    beforeEach(async () => {
        [owner, dev, addr1, addr2] = await ethers.getSigners();

        const {
            TestOracle,
            Operatable, CheckPermission, Stock, RStablecoin,
            Locker, Gauge, GaugeFactory, Boost
        } = await $.setup();

        usdc = await $.mockToken("usdc", "usdc", 18, 0);

        await usdc.mint(owner.address, toWei('10000000'));
        await usdc.mint(dev.address, toWei('100000'));
        await usdc.mint(addr1.address, toWei('100000'));
        await usdc.mint(addr2.address, toWei('100000'));

        operatable = await Operatable.deploy();
        checkPermission = await CheckPermission.deploy(operatable.address);

        oracle = await TestOracle.deploy();
        fxs = await Stock.deploy(checkPermission.address, "fxs", "fxs", oracle.address);
        frax = await RStablecoin.deploy(checkPermission.address, "frax", "frax");

        await fxs.setStableAddress(frax.address);
        await frax.setStockAddress(fxs.address);

        await fxs.transfer(dev.address, toWei("10000"));
        await fxs.transfer(addr1.address, toWei("10000"));
        await fxs.transfer(addr2.address, toWei("10000"));

        let lastBlock = await time.latestBlock();

        locker = await Locker.deploy(checkPermission.address, fxs.address, parseInt('1800'));

        gaugeFactory = await GaugeFactory.deploy(checkPermission.address);

        boost = await Boost.deploy(
            checkPermission.address,
            locker.address,
            gaugeFactory.address,
            fxs.address,
            toWei("1"),
            parseInt(lastBlock),
            "1000"
        );

        await locker.addBoosts(boost.address);

        await boost.createGauge(usdc.address, "100", true);

        gaugeUsdcAddr = await boost.gauges(usdc.address);
        gauge_usdc = await Gauge.attach(gaugeUsdcAddr);
        expect(gauge_usdc.address).to.be.eq(gaugeUsdcAddr);

        await fxs.addPool(boost.address);

        await fxs.approve(locker.address, toWei('10000000'));
        await fxs.connect(dev).approve(locker.address, toWei('10000'));
        await fxs.connect(addr1).approve(locker.address, toWei('10000'));
        await fxs.connect(addr2).approve(locker.address, toWei('10000'));

        await usdc.approve(gauge_usdc.address, toWei('10000000'));
        await usdc.connect(dev).approve(gauge_usdc.address, toWei('10000'));
        await usdc.connect(addr1).approve(gauge_usdc.address, toWei('10000'));
        await usdc.connect(addr2).approve(gauge_usdc.address, toWei('10000'));
    });

    it("test users to boost mul", async () => {
        let _duration = time.duration.years(1);

        // 1、
        await locker.createLock(toWei('1000'), parseInt(_duration));
        let tokenId1 = await locker.tokenId();

        await gauge_usdc.deposit(toWei('100'));
        await boost.vote(tokenId1, [usdc.address], [toWei('10')]);

        //2、
        await locker.connect(dev).createLock(toWei("1"), parseInt(parseInt(_duration)));
        let tokenId2 = await locker.tokenId();

        await gauge_usdc.connect(dev).deposit(toWei('100'));
        await boost.connect(dev).vote(tokenId2, [usdc.address], [toWei('10')]);

        let pendingMaxOwnerBef = await gauge_usdc.pendingMax(owner.address);
        let pendingOwnerBef = await gauge_usdc.pending(owner.address);
        let pendingMaxDevBef = await gauge_usdc.pendingMax(dev.address);
        let pendingDevBef = await gauge_usdc.pending(dev.address);

        expect(pendingOwnerBef).to.be.lt(pendingMaxOwnerBef);
        expect(pendingDevBef).to.be.lt(pendingMaxDevBef);

        //3、
        await locker.connect(addr1).createLock(toWei("50"), parseInt(parseInt(_duration)));
        let tokenId3 = await locker.tokenId();

        await gauge_usdc.connect(addr1).deposit(toWei('100'));
        await boost.connect(addr1).vote(tokenId3, [usdc.address], [toWei('10')]);

        //4、
        await locker.connect(addr2).createLock(toWei("0.000001"), parseInt(parseInt(_duration)));
        let tokenId4 = await locker.tokenId();

        await gauge_usdc.connect(addr2).deposit(toWei('100'));
        await boost.connect(addr2).vote(tokenId4, [usdc.address], [toWei('10')]);

        let pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        let pendingOwner = await gauge_usdc.pending(owner.address);
        let pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        let pendingDev = await gauge_usdc.pending(dev.address);
        let pendingMaxAddr1 = await gauge_usdc.pendingMax(addr1.address);
        let pendingAddr1 = await gauge_usdc.pending(addr1.address);
        let pendingMaxAddr2 = await gauge_usdc.pendingMax(addr2.address);
        let pendingAddr2 = await gauge_usdc.pending(addr2.address);

        expect(pendingMaxOwner).to.be.gt(pendingOwner);
        expect(pendingDevBef).to.be.lt(pendingDev);
        expect(pendingMaxDev).to.be.gt(pendingDev);
        expect(pendingMaxAddr1).to.be.gt(pendingAddr1);
        expect(pendingMaxAddr2).to.be.gt(pendingAddr2);

        let boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulAddr1 = new Decimal(pendingAddr1 / (pendingMaxAddr1 * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let _boostMulAddr2 = pendingAddr2 / (pendingMaxAddr2 * 30 / 100);
        let boostMulAddr2 = new Decimal(_boostMulAddr2).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.2201");
        expect(boostMulDev).to.be.eq("1.0022");
        expect(boostMulAddr1).to.be.eq("1.1110");
        expect(boostMulAddr2).to.be.eq("1.0000");
        expect(_boostMulAddr2).to.be.gt(1);

        // mul will decrease
        await time.increase(await time.duration.hours(11));

        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);
        pendingMaxAddr1 = await gauge_usdc.pendingMax(addr1.address);
        pendingAddr1 = await gauge_usdc.pending(addr1.address);
        pendingMaxAddr2 = await gauge_usdc.pendingMax(addr2.address);
        pendingAddr2 = await gauge_usdc.pending(addr2.address);

        let boostMulOwnerAft = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulDevAft = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulAddr1Aft = new Decimal(pendingAddr1 / (pendingMaxAddr1 * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let _boostMulAddr2Aft = pendingAddr2 / (pendingMaxAddr2 * 30 / 100);
        let boostMulAddr2Aft = new Decimal(_boostMulAddr2).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwnerAft).to.be.eq("3.2173");
        expect(boostMulDevAft).to.be.eq("1.0022");
        expect(boostMulAddr1Aft).to.be.eq("1.1108");
        expect(boostMulAddr2Aft).to.be.eq("1.0000");
        expect(_boostMulAddr2Aft).to.be.gt(1);

        // // mul will expired
        await time.increase(await time.duration.days(1));

        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);
        pendingMaxAddr1 = await gauge_usdc.pendingMax(addr1.address);
        pendingAddr1 = await gauge_usdc.pending(addr1.address);
        pendingMaxAddr2 = await gauge_usdc.pendingMax(addr2.address);
        pendingAddr2 = await gauge_usdc.pending(addr2.address);

        let boostMulOwnerAft1 = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulDevAft1 = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulAddr1Aft1 = new Decimal(pendingAddr1 / (pendingMaxAddr1 * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulAddr2Aft1 = new Decimal(pendingAddr2 / (pendingMaxAddr2 * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwnerAft1).to.be.eq("3.2112");
        expect(boostMulDevAft1).to.be.eq("1.0022");
        expect(boostMulAddr1Aft1).to.be.eq("1.1105");
        expect(boostMulAddr2Aft1).to.be.eq("1.0000");
    });

    it("test users to boost mul and getReward", async () => {

        await fxs.approve(locker.address, toWei("10000000"));
        // 1、
        let _duration = time.duration.years(4);
        await locker.createLock(toWei('0.1'), parseInt(_duration));
        let tokenId1 = await locker.tokenId();

        await gauge_usdc.deposit(toWei('1500')); //10
        await boost.vote(tokenId1, [usdc.address], [toWei('2000000')]);//200000

        //2、
        _duration = time.duration.days(100);
        await locker.connect(dev).createLock(toWei("0.1"), parseInt(parseInt(_duration)));
        let tokenId2 = await locker.tokenId();

        await gauge_usdc.connect(dev).deposit(toWei('1')); //10
        await boost.connect(dev).vote(tokenId2, [usdc.address], [toWei('1000000')]);//1000

        let pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        let pendingOwner = await gauge_usdc.pending(owner.address);
        let pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        let pendingDev = await gauge_usdc.pending(dev.address);

        let boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        let boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.1837");
        expect(boostMulDev).to.be.eq("1.1495");

        // console.log("=================increase 10 minutes=================");
        await time.increase(await time.duration.minutes(10));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.1837");
        expect(boostMulDev).to.be.eq("1.1495");

        // console.log("=================increase 10 minutes=================");
        await time.increase(await time.duration.minutes(10));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.1837");
        expect(boostMulDev).to.be.eq("1.1495");

        let ownerFxsBef = await fxs.balanceOf(owner.address);
        let userBef = await gauge_usdc.userInfo(owner.address);

        await gauge_usdc.getReward(owner.address);

        let ownerFxsAft = await fxs.balanceOf(owner.address);
        let userAft = await gauge_usdc.userInfo(owner.address);

        expect(ownerFxsAft).to.be.gt(ownerFxsBef);
        expect(userBef.rewardDebt).to.be.eq(0);
        expect(userAft.rewardDebt).to.be.gt(userBef.rewardDebt);

        // console.log("=================owner getReward=================");
        // console.log("=================increase 1 hours=================");
        await time.advanceBlockTo(parseInt(await time.latestBlock()) + 1)
        await time.increase(await time.duration.hours(1));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(3, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(3, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.183");
        expect(boostMulDev).to.be.eq("1.149");

        // console.log("=================increase 20 hours=================");
        await time.increase(await time.duration.hours(20));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.1824");
        expect(boostMulDev).to.be.eq("1.1482");

        // console.log("=================increase 2 days=================");
        await time.increase(await time.duration.days(2));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.1794");
        expect(boostMulDev).to.be.eq("1.1452");

        // console.log("=================increase 10 weeks=================");
        await time.increase(await time.duration.weeks(10));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("3.0747");
        expect(boostMulDev).to.be.eq("1.0405");

        // console.log("=================increase 2 years=================");
        await time.increase(await time.duration.years(2));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("1.9828");
        expect(boostMulDev).to.be.eq("1.0000");

        // console.log("=================increase 1 years=================");
        await time.increase(await time.duration.years(1));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(3, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(3, Decimal.ROUND_DOWN);

        expect(boostMulOwner).to.be.eq("1.436");
        expect(boostMulDev).to.be.eq("1.000");

        // console.log("=================increase 1 years=================");
        await time.increase(await time.duration.years(1));
        pendingMaxOwner = await gauge_usdc.pendingMax(owner.address);
        pendingOwner = await gauge_usdc.pending(owner.address);
        pendingMaxDev = await gauge_usdc.pendingMax(dev.address);
        pendingDev = await gauge_usdc.pending(dev.address);

        boostMulOwner = new Decimal(pendingOwner / (pendingMaxOwner * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);
        boostMulDev = new Decimal(pendingDev / (pendingMaxDev * 30 / 100)).toFixed(4, Decimal.ROUND_DOWN);

        expect(BigNumber.from(pendingMaxOwner.toString()).mul(30).div(100)).to.be.eq(BigNumber.from(pendingOwner.toString()));
        expect(BigNumber.from(pendingMaxDev.toString()).mul(30).div(100)).to.be.eq(BigNumber.from(pendingDev.toString()));
        expect(boostMulOwner).to.be.eq("0.9999");
        expect(boostMulDev).to.be.eq("1.0000");
    });
});
