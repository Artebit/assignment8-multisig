const { expect } = require("chai");
const { ethers } = require("hardhat");

async function expectRevert(promise, reason) {
  try {
    await promise;
    expect.fail("Expected transaction to be reverted");
  } catch (error) {
    expect(error.message).to.include(reason);
  }
}

describe("MultiSigWallet", function () {
  let wallet;
  let owner1;
  let owner2;
  let owner3;
  let nonOwner;
  let receiver;

  beforeEach(async function () {
    [owner1, owner2, owner3, nonOwner, receiver] = await ethers.getSigners();

    const MultiSigWallet = await ethers.getContractFactory("MultiSigWallet");

    wallet = await MultiSigWallet.deploy(
      [owner1.address, owner2.address, owner3.address],
      2
    );

    await wallet.deployed();
  });

  it("deploys with correct owners and required confirmations", async function () {
    expect((await wallet.required()).toNumber()).to.equal(2);
    expect(await wallet.isOwner(owner1.address)).to.equal(true);
    expect(await wallet.isOwner(owner2.address)).to.equal(true);
    expect(await wallet.isOwner(owner3.address)).to.equal(true);
    expect(await wallet.isOwner(nonOwner.address)).to.equal(false);
  });

  it("receives ether", async function () {
    await owner1.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther("1"),
    });

    const balance = await ethers.provider.getBalance(wallet.address);
    expect(balance.eq(ethers.utils.parseEther("1"))).to.equal(true);
  });

  it("allows owner to submit transaction", async function () {
    await wallet.submitTransaction(
      receiver.address,
      ethers.utils.parseEther("0.5"),
      "0x"
    );

    expect((await wallet.getTransactionCount()).toNumber()).to.equal(1);

    const tx = await wallet.getTransaction(0);
    expect(tx.to).to.equal(receiver.address);
    expect(tx.value.eq(ethers.utils.parseEther("0.5"))).to.equal(true);
    expect(tx.executed).to.equal(false);
    expect(tx.numConfirmations.toNumber()).to.equal(0);
  });

  it("rejects transaction submission from non-owner", async function () {
    await expectRevert(
      wallet
        .connect(nonOwner)
        .submitTransaction(receiver.address, ethers.utils.parseEther("0.5"), "0x"),
      "not owner"
    );
  });

  it("confirms transaction by multiple owners", async function () {
    await wallet.submitTransaction(receiver.address, 0, "0x");

    await wallet.connect(owner1).confirmTransaction(0);
    await wallet.connect(owner2).confirmTransaction(0);

    const tx = await wallet.getTransaction(0);
    expect(tx.numConfirmations.toNumber()).to.equal(2);
  });

  it("rejects duplicate confirmation", async function () {
    await wallet.submitTransaction(receiver.address, 0, "0x");

    await wallet.connect(owner1).confirmTransaction(0);

    await expectRevert(
      wallet.connect(owner1).confirmTransaction(0),
      "tx already confirmed"
    );
  });

  it("allows owner to revoke confirmation before execution", async function () {
    await wallet.submitTransaction(receiver.address, 0, "0x");

    await wallet.connect(owner1).confirmTransaction(0);
    await wallet.connect(owner1).revokeConfirmation(0);

    const tx = await wallet.getTransaction(0);
    expect(tx.numConfirmations.toNumber()).to.equal(0);
    expect(await wallet.isConfirmed(0, owner1.address)).to.equal(false);
  });

  it("rejects execution without enough confirmations", async function () {
    await owner1.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther("1"),
    });

    await wallet.submitTransaction(
      receiver.address,
      ethers.utils.parseEther("0.5"),
      "0x"
    );

    await wallet.connect(owner1).confirmTransaction(0);

    await expectRevert(
      wallet.executeTransaction(0),
      "not enough confirmations"
    );
  });

  it("executes transaction after required confirmations", async function () {
    await owner1.sendTransaction({
      to: wallet.address,
      value: ethers.utils.parseEther("1"),
    });

    await wallet.submitTransaction(
      receiver.address,
      ethers.utils.parseEther("0.5"),
      "0x"
    );

    await wallet.connect(owner1).confirmTransaction(0);
    await wallet.connect(owner2).confirmTransaction(0);

    const walletBalanceBefore = await ethers.provider.getBalance(wallet.address);
    const receiverBalanceBefore = await ethers.provider.getBalance(receiver.address);

    await wallet.executeTransaction(0);

    const walletBalanceAfter = await ethers.provider.getBalance(wallet.address);
    const receiverBalanceAfter = await ethers.provider.getBalance(receiver.address);

    expect(walletBalanceBefore.sub(walletBalanceAfter).eq(ethers.utils.parseEther("0.5"))).to.equal(true);
    expect(receiverBalanceAfter.sub(receiverBalanceBefore).eq(ethers.utils.parseEther("0.5"))).to.equal(true);

    const tx = await wallet.getTransaction(0);
    expect(tx.executed).to.equal(true);
  });

  it("rejects unauthorized confirmation", async function () {
    await wallet.submitTransaction(receiver.address, 0, "0x");

    await expectRevert(
      wallet.connect(nonOwner).confirmTransaction(0),
      "not owner"
    );
  });
});