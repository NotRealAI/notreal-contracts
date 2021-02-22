const getGasCosts = require('../../../helpers/getGasCosts');
const addEditionCreators = require('../../../helpers/nrda');
const getEtherBalance = require('../../../helpers/getBalance');
const getTokenBalance = require('../../../helpers/getTokenBalance');
let getBalance;
const toBN = require('../../../helpers/toBN');
const assertRevert = require('../../../helpers/assertRevert');
const etherToWei = require('../../../helpers/etherToWei');
const bnChai = require('bn-chai');

const _ = require('lodash');

const ForceEther = artifacts.require('ForceEther');
const NotRealDigitalAssetV2 = artifacts.require('NotRealDigitalAssetV2');
const ArtistAcceptingBidsV2 = artifacts.require('ArtistAcceptingBidsV2');
const ERC20Mock = artifacts.require('ERC20Mock');

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(web3.utils.BN))
  .should();

contract('ArtistAcceptingBidsV2', function (accounts) {

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  const ROLE_MINTER = web3.utils.keccak256('ROLE_MINTER');

  const _owner = accounts[0];
  const nrCommission = accounts[1];

  const artistAccount1 = accounts[2];
  const artistAccount2 = accounts[3];

  const bidder1 = accounts[4];
  const bidder2 = accounts[5];
  const bidder3 = accounts[6];
  const bidder4 = accounts[7];

  const editionNumber1 = 100000;
  const editionType = 1;
  const editionData1 = web3.utils.asciiToHex("editionData1");
  const editionTokenUri1 = "edition1";
  const edition1Price = etherToWei(0.1);

  const artistCommission = toBN(76);
  const totalAvailable = 5;

  beforeEach(async () => {
    this.erc20 = await ERC20Mock.new('Token', 'MTKN', _owner, 0, {from:_owner});
    getBalance = getTokenBalance(this.erc20);

    // Create contracts
    this.nrda = await NotRealDigitalAssetV2.new(this.erc20.address, {from: _owner});
    addEditionCreators(this.nrda);

    this.auction = await ArtistAcceptingBidsV2.new(this.nrda.address, this.erc20.address, {from: _owner});

    await Promise.all(accounts.slice(0,8).map(async acct => {
      await this.erc20.mint(acct, etherToWei(9999), { from: _owner })
      await this.erc20.approve(this.nrda.address, etherToWei(9999), {from: acct});
      await this.erc20.approve(this.auction.address, etherToWei(9999), {from: acct});
    }))

    // Update the commission account to be something different than owner
    await this.auction.setNrCommissionAccount(nrCommission, {from: _owner});

    // Whitelist the auction contract
    await this.nrda.addAddressToAccessControl(this.auction.address, ROLE_MINTER, {from: _owner});

    // Grab the min bid amount
    this.minBidAmount = toBN(await this.auction.minBidAmount());
  });

  beforeEach(async () => {
    // Create a new edition, unsold with 5 available
    await this.nrda.createActiveEdition(editionNumber1, editionData1, editionType, 0, 0, artistAccount1, artistCommission, edition1Price, editionTokenUri1, totalAvailable, {from: _owner});
  });

  describe('constructed properly', async () => {
    it('owner is set', async () => {
      let owner = await this.auction.owner();
      owner.should.be.equal(_owner);
    });

    it('NRDA address is set', async () => {
      let nrdaAddress = await this.auction.nrdaAddress();
      nrdaAddress.should.be.equal(this.nrda.address);
    });

    it('min bid is set', async () => {
      let minBidAmount = await this.auction.minBidAmount();
      minBidAmount.should.be.eq.BN(etherToWei(0.01));
    });

    describe('Once an edition is configured', async () => {
      beforeEach(async () => {
        await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
      });

      it('is not paused', async () => {
        let paused = await this.auction.paused();
        paused.should.be.equal(false);
      });

      it('no one if the highest bidder', async () => {
        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(ZERO_ADDRESS);
        details[1].should.be.eq.BN(0);
      });

      it('is enabled', async () => {
        let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
        isEditionEnabled.should.be.equal(true);
      });

      it('controller is set', async () => {
        let editionController = await this.auction.editionController(editionNumber1);
        editionController.should.be.equal(artistAccount2);
      });
    });
  });

  describe('placing a bid', async () => {

    it('fails if not set up', async () => {
      await assertRevert(this.auction.placeBid(editionNumber1, this.minBidAmount, {from: bidder1}));
    });

    describe('once auction setup enabled', async () => {

      beforeEach(async () => {
        // Enable the edition and use a different artist address than the original NRDA edition artist
        await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
      });

      it('should be enabled', async () => {
        let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
        isEditionEnabled.should.be.equal(true);
      });

      it('should have an edition controller', async () => {
        let editionController = await this.auction.editionController(editionNumber1);
        editionController.should.be.equal(artistAccount2);
      });

      it('should not have a highest bid yet', async () => {
        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(ZERO_ADDRESS);
        details[1].should.be.eq.BN(0);
      });

      describe('can make a simple bid', async () => {

        beforeEach(async () => {
          await this.erc20.approve(this.auction.address, etherToWei(9999), {from: bidder1});
          await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        });

        it('should be highest bidder', async () => {
          let details = await this.auction.highestBidForEdition(editionNumber1);
          details[0].should.be.equal(bidder1);
          details[1].should.be.eq.BN(this.minBidAmount);
        });

        it('auction details are populated', async () => {
          let details = await this.auction.auctionDetails(editionNumber1);
          details[0].should.be.equal(true); // bool _enabled
          details[1].should.be.equal(bidder1); // address _bidder
          details[2].should.be.eq.BN(this.minBidAmount); // uint256 _value
        });

        it('another bidder cant place a bid at the same value as you', async () => {
          assertRevert(this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder2}));
        });

        it('another bidder cant place a bid below value of yours', async () => {
          assertRevert(this.auction.placeBid(editionNumber1,  this.minBidAmount.sub(toBN(1)), {from: bidder2}));
        });

        it('contract holds bid value', async () => {
          let auctionBalance = await getBalance(this.auction.address);
          auctionBalance.should.be.eq.BN(this.minBidAmount);
        });

        describe('once a bid is made you can increase it', async () => {
          it('will fail if the same bidder makes another bid', async () => {
            await assertRevert(this.auction.placeBid(editionNumber1, this.minBidAmount.mul(toBN(2)), {
              from: bidder1
            }));
          });

          it('can still increase bid once set', async () => {
            await this.auction.increaseBid(editionNumber1, this.minBidAmount, {
              from: bidder1
            });

            // Check still highest bid
            let highestbidder = await this.auction.highestBidForEdition(editionNumber1);
            highestbidder[0].should.be.equal(bidder1);
            highestbidder[1].should.be.eq.BN(this.minBidAmount.mul(toBN(2)));

            // contract balance updated
            let auctionBalance = await getBalance(this.auction.address);
            auctionBalance.should.be.eq.BN(this.minBidAmount.mul(toBN(2)));

            // details are updated
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(bidder1); // address _bidder
            details[2].should.be.eq.BN(this.minBidAmount.mul(toBN(2))); // uint256 _value
          });
        });

        describe('once a bid is made you can withdraw it', async () => {
          let bidder1BeforeBalance;
          let bidder1AfterBalance;

          let txGasCosts;

          let auctionBeforeBalance;
          let auctionAfterBalance;

          beforeEach(async () => {
            bidder1BeforeBalance = await getBalance(bidder1);
            auctionBeforeBalance = await getBalance(this.auction.address);

            let tx = await this.auction.withdrawBid(editionNumber1, {from: bidder1});
            txGasCosts = toBN(0);
            //txGasCosts = await getGasCosts(tx);

            bidder1AfterBalance = await getBalance(bidder1);
            auctionAfterBalance = await getBalance(this.auction.address);
          });

          it('should refund funds', async () => {
            // Check bidder 1 has funds returned
            bidder1AfterBalance.should.be.eq.BN(
              bidder1BeforeBalance
                .add(this.minBidAmount) // refunds the bid amount
                .sub(txGasCosts) // minus the gas costs
            );

            // Check auction contract not holding any funds
            auctionAfterBalance.should.be.eq.BN(0);
          });

          it('should revert to not having a highest bid yet', async () => {
            let details = await this.auction.highestBidForEdition(editionNumber1);
            details[0].should.be.equal(ZERO_ADDRESS);
            details[1].should.be.eq.BN(0);
          });

          it('auction details are populated', async () => {
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
            details[2].should.be.eq.BN(0); // uint256 _value
          });
        });

        describe('cancelling an auction one a bid is made', async () => {

          describe('when not owner', async () => {
            it('fails', async () => {
              await assertRevert(this.auction.cancelAuction(editionNumber1, {from: bidder1}));
            });
          });

          describe('when not valid edition address', async () => {
            it('fails', async () => {
              await assertRevert(this.auction.cancelAuction(99999, {from: _owner}));
            });
          });

          describe('when owner', async () => {
            let bidder1BeforeBalance;
            let bidder1AfterBalance;

            beforeEach(async () => {
              bidder1BeforeBalance = await getBalance(bidder1);

              await this.auction.cancelAuction(editionNumber1, {from: _owner});

              bidder1AfterBalance = await getBalance(bidder1);
            });

            it('reverts bidders funds', async () => {
              // Check bidder 1 has funds returned
              bidder1AfterBalance.should.be.eq.BN(
                bidder1BeforeBalance.add(this.minBidAmount)
              );
            });

            it('no more funds held in contract', async () => {
              let auctionBalance = await getBalance(this.auction.address);
              auctionBalance.should.be.eq.BN(0);
            });

            it('set edition auction disable', async () => {
              let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
              isEditionEnabled.should.be.equal(false);
            });

            it('should revert to not having a highest bid yet', async () => {
              let details = await this.auction.highestBidForEdition(editionNumber1);
              details[0].should.be.equal(ZERO_ADDRESS);
              details[1].should.be.eq.BN(0);
            });

            it('auction details are populated', async () => {
              let details = await this.auction.auctionDetails(editionNumber1);
              details[0].should.be.equal(false); // bool _enabled
              details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
              details[2].should.be.eq.BN(0); // uint256 _value
            });
          });

        });

        describe('artist can accept the bid', async () => {

          describe('when not controlling address', async () => {
            it('fails', async () => {
              await assertRevert(this.auction.acceptBid(editionNumber1, {from: bidder1}));
            });
          });

          describe('when not valid edition address', async () => {
            it('fails', async () => {
              await assertRevert(this.auction.acceptBid(99999, {from: _owner}));
            });
          });

          describe('when is controlling address', async () => {
            let artistAccount2BalanceBefore;
            let artistAccount2BalanceAfter;

            let artistAccount1BalanceBefore;
            let artistAccount1BalanceAfter;

            let nrAccount2BalanceBefore;
            let nrAccount2BalanceAfter;

            let contractBalanceBefore;
            let contractBalanceAfter;

            let bidderBalanceBefore;
            let bidderBalanceAfter;

            let txGasCosts;

            beforeEach(async () => {
              artistAccount1BalanceBefore = await getBalance(artistAccount1);
              artistAccount2BalanceBefore = await getBalance(artistAccount2);
              bidderBalanceBefore = await getBalance(bidder1);
              nrAccount2BalanceBefore = await getBalance(nrCommission);
              contractBalanceBefore = await getBalance(this.auction.address);

              let tx = await this.auction.acceptBid(editionNumber1, {from: artistAccount2});
              //txGasCosts = await getGasCosts(tx);
              txGasCosts = toBN(0);

              artistAccount1BalanceAfter = await getBalance(artistAccount1);
              artistAccount2BalanceAfter = await getBalance(artistAccount2);
              bidderBalanceAfter = await getBalance(bidder1);
              nrAccount2BalanceAfter = await getBalance(nrCommission);
              contractBalanceAfter = await getBalance(this.auction.address);
            });

            it('tokenId is generated correctly', async () => {
              let tokens = await this.nrda.tokensOf(bidder1);
              tokens
                .map(e => e.toNumber())
                .should.be.deep.equal([editionNumber1 + 1]);
            });

            it('total minted is correctly updated', async () => {
              let total = await this.nrda.totalSupplyEdition(editionNumber1);
              total.should.be.eq.BN(1);
            });

            it('funds get sent to the artists based on commission percentage', async () => {
              const expectedArtistCommission = contractBalanceBefore.div(toBN(100)).mul(artistCommission);

              artistAccount1BalanceAfter.should.be.eq.BN(
                artistAccount1BalanceBefore.add(expectedArtistCommission)
              );
            });

            it('funds get sent to the ko commission account', async () => {
              const remainingCommission = toBN(100).sub(artistCommission);
              remainingCommission.should.be.eq.BN(24); // remaining commission of 24%

              const expectedNrCommission = contractBalanceBefore.div(toBN(100)).mul(remainingCommission);

              nrAccount2BalanceAfter.should.be.eq.BN(
                nrAccount2BalanceBefore.add(expectedNrCommission)
              );
            });

            it('calling controller address pays the gas', async () => {
              artistAccount2BalanceAfter.should.be.eq.BN(
                artistAccount2BalanceBefore.sub(txGasCosts)
              );
            });

            it('no more funds held in contract', async () => {
              // Confirm funds originally held
              contractBalanceBefore.should.be.eq.BN(this.minBidAmount);

              // Confirm funds now gone
              contractBalanceAfter.should.be.eq.BN(0);
            });

            it('bidder balance does not change', async () => {
              bidderBalanceBefore.should.be.eq.BN(bidderBalanceAfter);
            });

            it('auction details are populated', async () => {
              let details = await this.auction.auctionDetails(editionNumber1);
              details[0].should.be.equal(true); // bool _enabled
              details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
              details[2].should.be.eq.BN(0); // uint256 _value
            });
          });

          describe('when is the owner address', async () => {
            let ownerBalanceBefore;
            let ownerBalanceAfter;

            let artistAccount1BalanceBefore;
            let artistAccount1BalanceAfter;

            let nrAccount2BalanceBefore;
            let nrAccount2BalanceAfter;

            let contractBalanceBefore;
            let contractBalanceAfter;

            let bidderBalanceBefore;
            let bidderBalanceAfter;

            let txGasCosts;

            beforeEach(async () => {
              artistAccount1BalanceBefore = await getBalance(artistAccount1);
              ownerBalanceBefore = await getBalance(_owner);
              bidderBalanceBefore = await getBalance(bidder1);
              nrAccount2BalanceBefore = await getBalance(nrCommission);
              contractBalanceBefore = await getBalance(this.auction.address);

              let tx = await this.auction.acceptBid(editionNumber1, {from: _owner});
              //txGasCosts = await getGasCosts(tx);
              txGasCosts = toBN(0);

              artistAccount1BalanceAfter = await getBalance(artistAccount1);
              ownerBalanceAfter = await getBalance(_owner);
              bidderBalanceAfter = await getBalance(bidder1);
              nrAccount2BalanceAfter = await getBalance(nrCommission);
              contractBalanceAfter = await getBalance(this.auction.address);
            });

            it('tokenId is generated correctly', async () => {
              let tokens = await this.nrda.tokensOf(bidder1);
              tokens
                .map(e => e.toNumber())
                .should.be.deep.equal([editionNumber1 + 1]);
            });

            it('total minted is correctly updated', async () => {
              let total = await this.nrda.totalSupplyEdition(editionNumber1);
              total.should.be.eq.BN(1);
            });

            it('funds get sent to the artists based on commission percentage', async () => {
              const expectedArtistCommission = contractBalanceBefore.div(toBN(100)).mul(artistCommission);

              artistAccount1BalanceAfter.should.be.eq.BN(
                artistAccount1BalanceBefore.add(expectedArtistCommission)
              );
            });

            it('funds get sent to the ko commission account', async () => {
              const remainingCommission = toBN(100).sub(artistCommission);
              remainingCommission.should.be.eq.BN(24); // remaining commission of 24%

              const expectedNrCommission = contractBalanceBefore.div(toBN(100)).mul(remainingCommission);

              nrAccount2BalanceAfter.should.be.eq.BN(
                nrAccount2BalanceBefore.add(expectedNrCommission)
              );
            });

            it('calling controller address pays the gas', async () => {
              ownerBalanceAfter.should.be.eq.BN(
                ownerBalanceBefore.sub(txGasCosts)
              );
            });

            it('no more funds held in contract', async () => {
              // Confirm funds originally held
              contractBalanceBefore.should.be.eq.BN(this.minBidAmount);

              // Confirm funds now gone
              contractBalanceAfter.should.be.eq.BN(0);
            });

            it('bidder balance does not change', async () => {
              bidderBalanceBefore.should.be.eq.BN(bidderBalanceAfter);
            });

            it('auction details are populated', async () => {
              let details = await this.auction.auctionDetails(editionNumber1);
              details[0].should.be.equal(true); // bool _enabled
              details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
              details[2].should.be.eq.BN(0); // uint256 _value
            });
          });

          describe('when there is an optional split in NRDA setup', async () => {
            let ownerBalanceBefore;
            let ownerBalanceAfter;

            let artistAccount1BalanceBefore;
            let artistAccount1BalanceAfter;

            let artistAccount2BalanceBefore;
            let artistAccount2BalanceAfter;

            let nrAccount2BalanceBefore;
            let nrAccount2BalanceAfter;

            let contractBalanceBefore;
            let contractBalanceAfter;

            let bidderBalanceBefore;
            let bidderBalanceAfter;

            let txGasCosts;

            const optionalRate = toBN(10);

            beforeEach(async () => {

              // Setup the optional split of 10% to artistAccount2
              await this.nrda.updateOptionalCommission(editionNumber1, optionalRate, artistAccount2, {from: _owner});

              artistAccount1BalanceBefore = await getBalance(artistAccount1);
              artistAccount2BalanceBefore = await getBalance(artistAccount2);
              ownerBalanceBefore = await getBalance(_owner);
              bidderBalanceBefore = await getBalance(bidder1);
              nrAccount2BalanceBefore = await getBalance(nrCommission);
              contractBalanceBefore = await getBalance(this.auction.address);

              let tx = await this.auction.acceptBid(editionNumber1, {from: _owner});
              //txGasCosts = await getGasCosts(tx);
              txGasCosts = toBN(0);

              artistAccount1BalanceAfter = await getBalance(artistAccount1);
              artistAccount2BalanceAfter = await getBalance(artistAccount2);
              ownerBalanceAfter = await getBalance(_owner);
              bidderBalanceAfter = await getBalance(bidder1);
              nrAccount2BalanceAfter = await getBalance(nrCommission);
              contractBalanceAfter = await getBalance(this.auction.address);
            });

            it('tokenId is generated correctly', async () => {
              let tokens = await this.nrda.tokensOf(bidder1);
              tokens
                .map(e => e.toNumber())
                .should.be.deep.equal([editionNumber1 + 1]);
            });

            it('total minted is correctly updated', async () => {
              let total = await this.nrda.totalSupplyEdition(editionNumber1);
              total.should.be.eq.BN(1);
            });

            it('funds get sent to the artists based on commission percentage', async () => {
              const expectedArtistCommission = contractBalanceBefore.div(toBN(100)).mul(artistCommission);

              artistAccount1BalanceAfter.should.be.eq.BN(
                artistAccount1BalanceBefore.add(expectedArtistCommission)
              );

              const expectedArtist2Commission = contractBalanceBefore.div(toBN(100)).mul(optionalRate);

              artistAccount2BalanceAfter.should.be.eq.BN(
                artistAccount2BalanceBefore.add(expectedArtist2Commission)
              );
            });

            it('funds get sent to the ko commission account', async () => {
              const remainingCommission = toBN(100).sub(artistCommission).sub(optionalRate);
              remainingCommission.should.be.eq.BN(14); // remaining commission of 14%

              const expectedNrCommission = contractBalanceBefore.div(toBN(100)).mul(remainingCommission);

              nrAccount2BalanceAfter.should.be.eq.BN(
                nrAccount2BalanceBefore.add(expectedNrCommission)
              );
            });

            it('calling controller address pays the gas', async () => {
              ownerBalanceAfter.should.be.eq.BN(
                ownerBalanceBefore.sub(txGasCosts)
              );
            });

            it('no more funds held in contract', async () => {
              // Confirm funds originally held
              contractBalanceBefore.should.be.eq.BN(this.minBidAmount);

              // Confirm funds now gone
              contractBalanceAfter.should.be.eq.BN(0);
            });

            it('bidder balance does not change', async () => {
              bidderBalanceBefore.should.be.eq.BN(bidderBalanceAfter);
            });

            it('auction details are populated', async () => {
              let details = await this.auction.auctionDetails(editionNumber1);
              details[0].should.be.equal(true); // bool _enabled
              details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
              details[2].should.be.eq.BN(0); // uint256 _value
            });
          });

        });
      });
    });
  });

  describe('withdrawing a bid', async () => {

    const theBidder = bidder1;
    const anotherBidder = bidder2;

    beforeEach(async () => {
      // Enable the edition and use a different artist address than the original NRDA edition artist
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});

      // Place a bid on the edition
      await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: theBidder});
    });

    it('bid has been placed', async () => {
      let details = await this.auction.highestBidForEdition(editionNumber1);
      details[0].should.be.equal(theBidder);
      details[1].should.be.eq.BN(this.minBidAmount);
    });

    it('cant be withdrawn when not the originally bidder', async () => {
      await assertRevert(this.auction.withdrawBid(editionNumber1, {from: anotherBidder}));
    });

    it('cant be withdrawn when no bid exists', async () => {
      await assertRevert(this.auction.withdrawBid(123456, {from: theBidder}));
    });

    describe('when paused', async () => {

      beforeEach(async () => {
        await this.auction.pause({from: _owner});
      });

      it('cant be withdrawn when paused', async () => {
        await assertRevert(this.auction.withdrawBid(editionNumber1, {from: bidder1}));

        await this.auction.unpause({from: _owner});

        await this.auction.withdrawBid(editionNumber1, {from: bidder1});

        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(ZERO_ADDRESS);
        details[1].should.be.eq.BN(0);
      });
    });

    describe('when withdrawing the bid', async () => {

      let txGasCosts;
      let bidderBalanceBefore;
      let bidderBalanceAfter;

      let contractBalanceBefore;
      let contractBalanceAfter;

      beforeEach(async () => {
        bidderBalanceBefore = await getBalance(theBidder);
        contractBalanceBefore = await getBalance(this.auction.address);

        let tx = await this.auction.withdrawBid(editionNumber1, {from: theBidder});
        //txGasCosts = await getGasCosts(tx);
        txGasCosts = toBN(0);

        contractBalanceAfter = await getBalance(this.auction.address);
        bidderBalanceAfter = await getBalance(theBidder);
      });

      it('clears down the highest bid', async () => {
        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(ZERO_ADDRESS);
        details[1].should.be.eq.BN(0);
      });

      it('no more funds held in contract', async () => {
        // Confirm funds originally held
        contractBalanceBefore.should.be.eq.BN(this.minBidAmount);

        // Confirm funds now gone
        contractBalanceAfter.should.be.eq.BN(0);
      });

      it('should return the finds to the bidder', async () => {
        bidderBalanceAfter.should.be.eq.BN(
          bidderBalanceBefore
            .add(this.minBidAmount) // refund the bid
            .sub(txGasCosts) // pay for the transaction
        );
      });

      it('cant increase your bid once its been withdrawn', async () => {
        await assertRevert(this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: theBidder}));
      });

      it('cant withdraw your bid once its been withdrawn', async () => {
        await assertRevert(this.auction.withdrawBid(editionNumber1, {from: theBidder}));
      });

      it('can place a new bid once its been withdrawn', async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: theBidder});

        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(theBidder);
        details[1].should.be.eq.BN(this.minBidAmount);
      });

    });

  });

  describe('increasing a bid', async () => {

    beforeEach(async () => {
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
    });

    it('cant increase it when no bid exists', async () => {
      await assertRevert(this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
    });

    describe('when the bid is made', async () => {
      const theBidder = bidder1;

      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: theBidder});
      });

      it('cant increase your bid by less than min value', async () => {
        await assertRevert(this.auction.increaseBid(editionNumber1, this.minBidAmount.sub(toBN(1)), {
          from: bidder1
        }));
      });

      it('cant increase your bid if you are no longer the top bidder', async () => {

        await this.auction.placeBid(editionNumber1,  this.minBidAmount.mul(toBN(2)), {from: bidder2});

        await assertRevert(this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
      });

      it('cant increase your bid if paused', async () => {
        await this.auction.pause({from: _owner});
        await assertRevert(this.auction.placeBid(editionNumber1, this.minBidAmount.mul(toBN(2)), {
          from: bidder2
        }));

        await this.auction.unpause({from: _owner});
        await this.auction.placeBid(editionNumber1,  this.minBidAmount.mul(toBN(2)), {from: bidder2});
      });

      it('can increase the bid once you are the highest bidder', async () => {
        let balanceBefore = await getBalance(this.auction.address);
        balanceBefore.should.be.eq.BN(this.minBidAmount);

        let detailsBefore = await this.auction.highestBidForEdition(editionNumber1);
        detailsBefore[0].should.be.equal(bidder1);
        detailsBefore[1].should.be.eq.BN(this.minBidAmount);

        await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        let detailsAfter = await this.auction.highestBidForEdition(editionNumber1);
        detailsAfter[0].should.be.equal(bidder1);
        detailsAfter[1].should.be.eq.BN(this.minBidAmount.mul(toBN(2)));

        let balanceAfter = await getBalance(this.auction.address);
        balanceAfter.should.be.eq.BN(this.minBidAmount.mul(toBN(2)));
      });

      it('can increase your bid multiple times', async () => {
        await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        let detailsAfter = await this.auction.highestBidForEdition(editionNumber1);
        detailsAfter[0].should.be.equal(bidder1);
        detailsAfter[1].should.be.eq.BN(this.minBidAmount.mul(toBN(5)));

        let balanceAfter = await getBalance(this.auction.address);
        balanceAfter.should.be.eq.BN(this.minBidAmount.mul(toBN(5)));
      });
    });
  });

  describe('multiple bidders on one edition', async () => {

    let bidder1_BalanceBeforeBid;
    let bidder1_BalanceAfterBid;

    let txGasCosts;

    beforeEach(async () => {
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
      bidder1_BalanceBeforeBid = await getBalance(bidder1);

      let tx = await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

      bidder1_BalanceAfterBid = await getBalance(bidder1);
      //txGasCosts = await getGasCosts(tx);
      txGasCosts = toBN(0)
    });

    it('bidder 1 is highest bidder', async () => {
      let details = await this.auction.highestBidForEdition(editionNumber1);
      details[0].should.be.equal(bidder1);
      details[1].should.be.eq.BN(this.minBidAmount);
    });

    it('contract balance is correct', async () => {
      let balanceAfter = await getBalance(this.auction.address);
      balanceAfter.should.be.eq.BN(this.minBidAmount);
    });

    it('bidder 1 balance has been deducted the bid amount & gas costs', async () => {
      bidder1_BalanceAfterBid.should.be.eq.BN(
        bidder1_BalanceBeforeBid
          .sub(this.minBidAmount) // the bid amount
          .sub(txGasCosts) // paid the transaction
      );
    });

    describe('Bidder 1 is outbid but Bidder 2', async () => {

      let _2ndBid;
      let bidder1_BalanceAfterBeingOutBid;

      let bidder2_BalanceBeforeBid;
      let bidder2_BalanceAfterBid;

      beforeEach(async () => {
        _2ndBid = this.minBidAmount.mul(toBN(2));

        bidder2_BalanceBeforeBid = await getBalance(bidder2);

        let tx = await this.auction.placeBid(editionNumber1,  _2ndBid, {from: bidder2});
        //txGasCosts = await getGasCosts(tx);
        txGasCosts = toBN(0);

        bidder2_BalanceAfterBid = await getBalance(bidder2);
        bidder1_BalanceAfterBeingOutBid = await getBalance(bidder1);
      });

      it('bidder 2 is highest bidder', async () => {
        let details = await this.auction.highestBidForEdition(editionNumber1);
        details[0].should.be.equal(bidder2);
        details[1].should.be.eq.BN(_2ndBid);
      });

      it('contract balance is correct', async () => {
        let balanceAfter = await getBalance(this.auction.address);
        balanceAfter.should.be.eq.BN(_2ndBid);
      });

      it('bidder 2 balance has been deducted the bid amount & gas costs', async () => {
        bidder2_BalanceAfterBid.should.be.eq.BN(
          bidder2_BalanceBeforeBid
            .sub(_2ndBid) // the bid amount
            .sub(txGasCosts) // paid the transaction
        );
      });

      it('bidder 1 is refunded his previous bid', async () => {
        bidder1_BalanceAfterBeingOutBid.should.be.eq.BN(
          bidder1_BalanceAfterBid.add(this.minBidAmount) // original funds are set back to the original bidder
        );
      });

      describe('Bidder 2 is outbid but Bidder 3', async () => {

        let _3rdBid; // Bidder 3 doubles the amount again

        let bidder2_BalanceAfterBeingOutBid;

        let bidder3_BalanceBeforeBid;
        let bidder3_BalanceAfterBid;

        beforeEach(async () => {
          _3rdBid = this.minBidAmount.mul(toBN(4));
          bidder3_BalanceBeforeBid = await getBalance(bidder3);

          let tx = await this.auction.placeBid(editionNumber1,  _3rdBid, {from: bidder3});
          //txGasCosts = await getGasCosts(tx);
          txGasCosts = toBN(0)

          bidder3_BalanceAfterBid = await getBalance(bidder3);
          bidder2_BalanceAfterBeingOutBid = await getBalance(bidder2);
        });

        it('Bidder 3 is highest bidder', async () => {
          let details = await this.auction.highestBidForEdition(editionNumber1);
          details[0].should.be.equal(bidder3);
          details[1].should.be.eq.BN(this.minBidAmount.mul(toBN(4)));
        });

        it('contract balance is correct', async () => {
          let balanceAfter = await getBalance(this.auction.address);
          balanceAfter.should.be.eq.BN(this.minBidAmount.mul(toBN(4)));
        });

        it('bidder 3 balance has been deducted the bid amount & gas costs', async () => {
          bidder3_BalanceAfterBid.should.be.eq.BN(
            bidder3_BalanceBeforeBid
              .sub(_3rdBid) // the bid amount
              .sub(txGasCosts) // paid the transaction
          );
        });

        it('bidder 2 is refunded his previous bid', async () => {
          bidder2_BalanceAfterBeingOutBid.should.be.eq.BN(
            bidder2_BalanceAfterBid.add(_2ndBid) // original funds are set back to the original bidder
          );
        });

        describe('Bidder 3 is outbid but Bidder 4', async () => {

          let _4thBid;

          let bidder3_BalanceAfterBeingOutBid;

          let bidder4_BalanceBeforeBid;
          let bidder4_BalanceAfterBid;

          beforeEach(async () => {
            _4thBid = this.minBidAmount.mul(toBN(5));
            bidder4_BalanceBeforeBid = await getBalance(bidder4);

            let tx = await this.auction.placeBid(editionNumber1,  _4thBid, {from: bidder4});
            txGasCosts = toBN(0);
            //txGasCosts = await getGasCosts(tx);

            bidder4_BalanceAfterBid = await getBalance(bidder4);
            bidder3_BalanceAfterBeingOutBid = await getBalance(bidder3);
          });

          it('Bidder 3 is highest bidder', async () => {
            let details = await this.auction.highestBidForEdition(editionNumber1);
            details[0].should.be.equal(bidder4);
            details[1].should.be.eq.BN(_4thBid);
          });

          it('contract balance is correct', async () => {
            let balanceAfter = await getBalance(this.auction.address);
            balanceAfter.should.be.eq.BN(_4thBid);
          });

          it('bidder 4 balance has been deducted the bid amount & gas costs', async () => {
            bidder4_BalanceAfterBid.should.be.eq.BN(
              bidder4_BalanceBeforeBid
                .sub(_4thBid) // the bid amount
                .sub(txGasCosts) // paid the transaction
            );
          });

          it('bidder 3 is refunded his previous bid', async () => {
            bidder3_BalanceAfterBeingOutBid.should.be.eq.BN(
              bidder3_BalanceAfterBid.add(_3rdBid) // original funds are set back to the original bidder
            );
          });
        });
      });
    });
  });

  describe('management controls', async () => {

    describe('global auction', async () => {

      describe('setting min bid', async () => {
        it('is possible when you are the owner', async () => {
          const originalMinBid = await this.auction.minBidAmount();
          originalMinBid.should.be.eq.BN(this.minBidAmount);

          await this.auction.setMinBidAmount(1, {from: _owner});

          const updatedMinBid = await this.auction.minBidAmount();
          updatedMinBid.should.be.eq.BN(1);
        });

        it('fails when you are NOT the owner', async () => {
          await assertRevert(this.auction.setMinBidAmount(1, {from: bidder1}));
        });
      });

      describe('can set a new NRDA address', async () => {
        it('is possible when you are the owner', async () => {
          const originalAddress = await this.auction.nrdaAddress();
          originalAddress.should.be.equal(this.nrda.address);

          await this.auction.setNrdavV2(ZERO_ADDRESS, {from: _owner});

          const updatedAddress = await this.auction.nrdaAddress();
          updatedAddress.should.be.equal(ZERO_ADDRESS);
        });
        it('fails when you are NOT the owner', async () => {
          await assertRevert(this.auction.setNrdavV2(ZERO_ADDRESS, {from: bidder1}));
        });
      });
    });

    describe('stuck ether', async () => {
      describe('withdrawing everything', async () => {
        it('fails when no ether left to withdraw', async () => {
          await assertRevert(this.auction.reclaimEther({from: _owner}));
        });

        it('is successful when owner and eth present to withdraw', async () => {
          await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
          await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

          const auctionBalance = await getBalance(this.auction.address);
          auctionBalance.should.be.eq.BN(this.minBidAmount);

          await this.auction.reclaimEther({from: _owner});

          const newAuctionBalance = await getBalance(this.auction.address);
          newAuctionBalance.should.be.eq.BN(0);
        });

        it('fails when NOT owner', async () => {
          await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
          await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

          const auctionBalance = await getBalance(this.auction.address);
          auctionBalance.should.be.eq.BN(this.minBidAmount);

          await assertRevert(this.auction.reclaimEther({from: bidder1}));
        });

        it('fails when address is zero', async () => {
          await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});
          await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

          const auctionBalance = await getBalance(this.auction.address);
          auctionBalance.should.be.eq.BN(this.minBidAmount);

          await assertRevert(this.auction.reclaimEther({from: _owner}));
        });

        it('force ether can still be withdrawn', async () => {
          const forceEther = await ForceEther.new({value: this.minBidAmount});
          await forceEther.destroyAndSend(this.auction.address);
          const forcedBalance = await getEtherBalance(this.auction.address);
          forcedBalance.should.be.eq.BN(this.minBidAmount);

          const ownerPreBalance = await getEtherBalance(_owner);

          const tx = await this.auction.reclaimEther({from: _owner});
          const txGasCosts = await getGasCosts(tx);

          const ownerPostBalance = await getEtherBalance(_owner);

          const postWithdrawalAuctionBalance = await getEtherBalance(this.auction.address);
          postWithdrawalAuctionBalance.should.be.eq.BN(0);

          ownerPostBalance.should.be.eq.BN(
            ownerPreBalance
              .sub(txGasCosts) // owner pays fee
              .add(this.minBidAmount) // gets all stuck ether sent to them
          );
        });

        it('tokens can be withdrawn', async () => {
          //const forceEther = await ForceEther.new({value: this.minBidAmount});
          //await forceEther.destroyAndSend(this.auction.address);
          await this.erc20.mint(this.auction.address, this.minBidAmount, { from: _owner });

          const forcedBalance = await getBalance(this.auction.address);
          forcedBalance.should.be.eq.BN(this.minBidAmount);

          const ownerPreBalance = await getBalance(_owner);

          const tx = await this.auction.reclaimEther({from: _owner});
          const txGasCosts = toBN(0);

          const ownerPostBalance = await getBalance(_owner);

          const postWithdrawalAuctionBalance = await getBalance(this.auction.address);
          postWithdrawalAuctionBalance.should.be.eq.BN(0);

          ownerPostBalance.should.be.eq.BN(
            ownerPreBalance
              .sub(txGasCosts) // owner pays fee
              .add(this.minBidAmount) // gets all stuck ether sent to them
          );
        });


      });
    });

    describe('edition controls', async () => {

      describe('enabled editions', async () => {
        it('is possible when you are the owner', async () => {
          await this.auction.enableEdition(editionNumber1, {from: _owner});
          let enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(true);

          await this.auction.disableEdition(editionNumber1, {from: _owner});
          enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(false);
        });

        it('fails when you are NOT the owner', async () => {
          await assertRevert(this.auction.enableEdition(editionNumber1, {from: bidder1}));
        });
      });

      describe('disable editions', async () => {
        it('is possible when you are the owner', async () => {
          await this.auction.enableEdition(editionNumber1, {from: _owner});
          let enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(true);

          await this.auction.disableEdition(editionNumber1, {from: _owner});
          enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(false);
        });

        it('fails when you are NOT the owner', async () => {
          await this.auction.enableEdition(editionNumber1, {from: _owner});
          let enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(true);

          await assertRevert(this.auction.disableEdition(editionNumber1, {from: bidder1}));

          enabled = await this.auction.isEditionEnabled(editionNumber1);
          enabled.should.be.equal(true);
        });
      });

      describe('setting artists control address', async () => {
        it('is possible when you are the owner', async () => {
          let editionController = await this.auction.editionController(editionNumber1);
          editionController.should.be.equal(ZERO_ADDRESS);

          await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: _owner});

          editionController = await this.auction.editionController(editionNumber1);
          editionController.should.be.equal(artistAccount2);
        });

        it('fails when you are NOT the owner', async () => {
          await assertRevert(this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount2, {from: bidder1}));

          // Still zero
          const editionController = await this.auction.editionController(editionNumber1);
          editionController.should.be.equal(ZERO_ADDRESS);
        });
      });
    });

    describe('setNrCommissionAccount', async () => {
      it('fails when zero address', async () => {
        await assertRevert(this.auction.setNrCommissionAccount(ZERO_ADDRESS, {from: _owner}));
      });
    });

    describe('override functions', async () => {

      beforeEach(async () => {
        await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
      });

      describe('manually overriding edition bid', async () => {

        // override bid to a lower amount
        const AMOUNT_BID_OVERRIDDEN_TO = etherToWei(0.0001);

        beforeEach(async () => {
          await this.auction.manualOverrideEditionHighestBidAndBidder(editionNumber1, bidder1, AMOUNT_BID_OVERRIDDEN_TO, {from: _owner});
        });

        it('fails if not the owner', async () => {
          // Attempting to lower the bid
          await assertRevert(this.auction.manualOverrideEditionHighestBidAndBidder(editionNumber1, bidder1, AMOUNT_BID_OVERRIDDEN_TO, {from: bidder1}));
        });

        it('contract balance show original balance', async () => {
          const contractBalance = await getBalance(this.auction.address);
          contractBalance.should.be.eq.BN(this.minBidAmount);
        });

        it('updates edition data', async () => {
          let details = await this.auction.auctionDetails(editionNumber1);
          details[0].should.be.equal(true); // bool _enabled
          details[1].should.be.equal(bidder1); // address _bidder
          details[2].should.be.eq.BN(AMOUNT_BID_OVERRIDDEN_TO); // uint256 _value
          details[3].should.be.equal(artistAccount1); // uint256 _value
        });

        it('can still increase bid', async () => {
          await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});

          let details = await this.auction.auctionDetails(editionNumber1);
          details[0].should.be.equal(true); // bool _enabled
          details[1].should.be.equal(bidder1); // address _bidder
          details[2].should.be.eq.BN(this.minBidAmount.add(AMOUNT_BID_OVERRIDDEN_TO)); // _value
          details[3].should.be.equal(artistAccount1); // uint256 _value
        });

        it('new bids can still be made', async () => {
          const beforeBeingOutBidBalance = await getBalance(bidder1);

          // min bid plus the current overridden
          const newBidValue = this.minBidAmount.add(AMOUNT_BID_OVERRIDDEN_TO);
          await this.auction.placeBid(editionNumber1,  newBidValue, {from: bidder2});

          const afterBeingOutBidBalance = await getBalance(bidder1);

          // Post being out bid they should only receive the amount overridden to and not the original balance put in
          afterBeingOutBidBalance.should.be.eq.BN(
            beforeBeingOutBidBalance.add(AMOUNT_BID_OVERRIDDEN_TO)
          );

          let details = await this.auction.auctionDetails(editionNumber1);
          details[0].should.be.equal(true); // bool _enabled
          details[1].should.be.equal(bidder2); // address _bidder
          details[2].should.be.eq.BN(newBidValue); // uint256 _value
          details[3].should.be.equal(artistAccount1); // address _controller

          // Contract balance shows the balance of the origianl bid plus the
          const contractBalance = await getBalance(this.auction.address);
          contractBalance.should.be.eq.BN(
            this.minBidAmount
              .add(this.minBidAmount) // overridden value has already be returned so only the two min bids
          );
        });

        describe('when accepting bids', async () => {

          let artistAccount1BalanceBefore;
          let artistAccount1BalanceAfter;

          let gasSpent;

          beforeEach(async () => {
            artistAccount1BalanceBefore = await getBalance(artistAccount1);

            // Artists accepts the bid
            let txs = await this.auction.acceptBid(editionNumber1, {from: artistAccount1});
            gasSpent = toBN(0);
            //gasSpent = await getGasCosts(txs);

            artistAccount1BalanceAfter = await getBalance(artistAccount1);
          });

          it('auction details reset after bid accepted', async () => {
            // Auction reset
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
            details[2].should.be.eq.BN(0); // uint256 _value
            details[3].should.be.equal(artistAccount1); // address _controller
          });

          it('auction contract balance is only reduced by overridden amount', async () => {
            // Check auction still holds balance
            const postAcceptingBidAuctionBalance = await getBalance(this.auction.address);
            postAcceptingBidAuctionBalance.should.be.eq.BN(
              this.minBidAmount.sub(AMOUNT_BID_OVERRIDDEN_TO) //  remaining balance
            );
          });

          it('funds split accordingly to artist', async () => {
            const expectedArtistCommission = AMOUNT_BID_OVERRIDDEN_TO.div(toBN(100)).mul(artistCommission);

            // Artists gets the commission but only to the overridden amount
            artistAccount1BalanceAfter.should.be.eq.BN(
              artistAccount1BalanceBefore
                .sub(gasSpent) // artists pays the fee
                .add(expectedArtistCommission) // plus 76% of the overridden price
            );
          });

        });

      });

      describe('manually deleting the bid values', async () => {

        it('fails if not the owner', async () => {
          await assertRevert(this.auction.manualDeleteEditionBids(editionNumber1, bidder1, {from: bidder1}));
        });

        describe('once deleted', async () => {

          beforeEach(async () => {
            await this.auction.manualDeleteEditionBids(editionNumber1, bidder1, {from: _owner});
          });

          it('contract balance correct balance', async () => {
            const contractBalance = await getBalance(this.auction.address);
            contractBalance.should.be.eq.BN(this.minBidAmount);
          });

          it('updates edition data', async () => {
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(ZERO_ADDRESS); // address _bidder
            details[2].should.be.eq.BN(0); // uint256 _value
            details[3].should.be.equal(artistAccount1); // uint256 _value
          });

          it('cannot accept the bid as its been removed', async () => {
            await assertRevert(this.auction.acceptBid(editionNumber1, {from: artistAccount1}));
          });

          it('bidder cannot increase there previous bid', async () => {
            await assertRevert(this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
          });

          it('bidder cannot withdraw there previous bid', async () => {
            await assertRevert(this.auction.withdrawBid(editionNumber1, {from: bidder1}));
          });

          it('the same bidder can place a new bid', async () => {
            // places new bid
            await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

            // they are then the winner again
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(bidder1); // address _bidder
            details[2].should.be.eq.BN(this.minBidAmount); // uint256 _value
            details[3].should.be.equal(artistAccount1); // uint256 _value

            // can still be out bid
            await this.auction.placeBid(editionNumber1,  this.minBidAmount.mul(toBN(2)), {from: bidder2});

            // bidder 2 is the new winner again
            details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(bidder2); // address _bidder
            details[2].should.be.eq.BN(this.minBidAmount.mul(toBN(2))); // uint256 _value
            details[3].should.be.equal(artistAccount1); // uint256 _value

            // Contract balance should show - new bidder plus originally deleted balance
            const contractBalance = await getBalance(this.auction.address);
            contractBalance.should.be.eq.BN(this.minBidAmount.mul(toBN(3)));
          });

          it('a new bidder can place a new bid', async () => {
            // places new bid
            await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder2});

            // they are then the winner again
            let details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(bidder2); // address _bidder
            details[2].should.be.eq.BN(this.minBidAmount); // uint256 _value
            details[3].should.be.equal(artistAccount1); // uint256 _value

            // can still be out bid
            await this.auction.placeBid(editionNumber1,  this.minBidAmount.mul(toBN(2)), {from: bidder3});

            // bidder 3 is the new winner again
            details = await this.auction.auctionDetails(editionNumber1);
            details[0].should.be.equal(true); // bool _enabled
            details[1].should.be.equal(bidder3); // address _bidder
            details[2].should.be.eq.BN(this.minBidAmount.mul(toBN(2))); // uint256 _value
            details[3].should.be.equal(artistAccount1); // uint256 _value

            // Contract balance should show - new bidder plus originally deleted balance
            const contractBalance = await getBalance(this.auction.address);
            contractBalance.should.be.eq.BN(this.minBidAmount.mul(toBN(3)));
          });
        });
      });

    });

  });

  describe('when edition sells out', async () => {

    beforeEach(async () => {
      // update NRDA to only have 1 left of that edition
      await this.nrda.updateTotalAvailable(editionNumber1, 1, {from: _owner});

      // Setup controller account for edition in auction
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});

      const totalRemaining = await this.nrda.totalRemaining(editionNumber1);
      totalRemaining.should.be.eq.BN(1);
    });

    describe('when it sells out before a auction is started', async () => {
      beforeEach(async () => {
        await this.nrda.purchase(editionNumber1,  edition1Price, {from: bidder2});
      });

      it('is not possible to placeBid', async () => {
        await assertRevert(this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
      });
    });


    describe('when it sells out after a bid has been placed', async () => {
      beforeEach(async () => {
        let totalRemaining = await this.nrda.totalRemaining(editionNumber1);
        totalRemaining.should.be.eq.BN(1);

        // Place bid
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        // sell edition out
        await this.nrda.purchase(editionNumber1,  edition1Price, {from: bidder2});

        totalRemaining = await this.nrda.totalRemaining(editionNumber1);
        totalRemaining.should.be.eq.BN(0);
      });

      it('is not possible to increaseBid', async () => {
        await assertRevert(this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
      });

      it('is not possible to acceptBid', async () => {
        await assertRevert(this.auction.acceptBid(editionNumber1, {from: artistAccount1}));
      });
    });

    describe('when the accepting the bid sells out the edition', async () => {
      beforeEach(async () => {
        // Place bid
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        const totalRemaining = await this.nrda.totalRemaining(editionNumber1);
        totalRemaining.should.be.eq.BN(1);
      });

      it('no more new auctions can be made', async () => {
        // Accept the bid
        await this.auction.acceptBid(editionNumber1, {from: artistAccount1});

        const totalRemaining = await this.nrda.totalRemaining(editionNumber1);
        totalRemaining.should.be.eq.BN(0);

        // fails when making a new bid as its sold out
        await assertRevert(this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1}));
      });

      it('edition is automatically set to disabled', async () => {
        let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
        isEditionEnabled.should.be.equal(true);

        // Accept the bid
        await this.auction.acceptBid(editionNumber1, {from: artistAccount1});

        isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
        isEditionEnabled.should.be.equal(false);
      });

    });

  });

  describe('setting artists control address', async () => {

    beforeEach(async () => {
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
    });

    it('fails when not owner', async () => {
      await assertRevert(this.auction.setArtistsControlAddress(editionNumber1, bidder1, {from: bidder2}));

      const controller = await this.auction.editionController(editionNumber1);
      controller.should.be.equal(artistAccount1);
    });

    it('can change control address', async () => {
      let controller = await this.auction.editionController(editionNumber1);
      controller.should.be.equal(artistAccount1);

      await this.auction.setArtistsControlAddress(editionNumber1, artistAccount2, {from: _owner});

      controller = await this.auction.editionController(editionNumber1);
      controller.should.be.equal(artistAccount2);
    });
  });

  describe('accepting bids', async () => {
    beforeEach(async () => {
      // Setup controller account for edition in auction
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
    });

    it('when all auctions Are paused', async () => {
      let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
      isEditionEnabled.should.be.equal(true);

      await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

      await this.auction.disableEdition(editionNumber1, {from: _owner});

      isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
      isEditionEnabled.should.be.equal(false);

      await assertRevert(this.auction.acceptBid(editionNumber1, {from: artistAccount1}));
    });

  });

  describe('Event are emit correctly at the right time', async () => {

    let setupEvent;
    beforeEach(async () => {
      const {logs} = await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
      setupEvent = logs;
    });

    it('AuctionEnabled', async () => {
      setupEvent[0].event.should.be.equal('AuctionEnabled');
      let {_editionNumber, _auctioneer} = setupEvent[0].args;
      _auctioneer.should.be.equal(artistAccount1);
      _editionNumber.should.be.eq.BN(editionNumber1);
    });

    describe('BidPlaced', async () => {
      let event;
      beforeEach(async () => {
        const data = await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        event = data.logs[0];
      });

      it('event populated', async () => {
        event.event.should.be.equal('BidPlaced');
        let {_bidder, _editionNumber, _amount} = event.args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });
    });

    describe('BidIncreased', async () => {
      let event;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        const data = await this.auction.increaseBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        event = data.logs[0];
      });

      it('event populated', async () => {
        event.event.should.be.equal('BidIncreased');
        let {_bidder, _editionNumber, _amount} = event.args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount.mul(toBN(2)));
      });
    });

    describe('BidWithdrawn', async () => {
      let events;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        const {logs} = await this.auction.withdrawBid(editionNumber1, {from: bidder1});
        events = logs;
      });

      it('BidderRefunded event populated', async () => {
        events[0].event.should.be.equal('BidderRefunded');
        let {_bidder, _editionNumber, _amount} = events[0].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });

      it('BidWithdrawn event populated', async () => {
        events[1].event.should.be.equal('BidWithdrawn');
        let {_bidder, _editionNumber} = events[1].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
      });
    });

    describe('BidAccepted', async () => {
      let events;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        const {logs} = await this.auction.acceptBid(editionNumber1, {from: artistAccount1});
        events = logs;
      });

      it('event populated', async () => {
        events[0].event.should.be.equal('BidAccepted');
        let {_bidder, _editionNumber, _tokenId, _amount} = events[0].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _tokenId.should.be.eq.BN(editionNumber1 + 1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });
    });

    describe('AuctionCancelled', async () => {

      let events;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        const {logs} = await this.auction.cancelAuction(editionNumber1, {from: _owner});
        events = logs;
      });

      it('BidderRefunded event populated', async () => {
        events[0].event.should.be.equal('BidderRefunded');
        let {_bidder, _editionNumber, _amount} = events[0].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });

      it('AuctionCancelled event populated', async () => {
        events[1].event.should.be.equal('AuctionCancelled');
        let {_editionNumber} = events[1].args;
        _editionNumber.should.be.eq.BN(editionNumber1);
      });
    });

    describe('BidderRefunded', async () => {

      let events;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});

        // get out bid
        const {logs} = await this.auction.placeBid(editionNumber1, this.minBidAmount.mul(toBN(2)), {
          from: bidder2
        });
        events = logs;
      });

      it('BidderRefunded event populated', async () => {
        events[0].event.should.be.equal('BidderRefunded');
        let {_bidder, _editionNumber, _amount} = events[0].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });

      it('BidPlaced event populated', async () => {
        events[1].event.should.be.equal('BidPlaced');
        let {_bidder, _editionNumber, _amount} = events[1].args;
        _bidder.should.be.equal(bidder2);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount.mul(toBN(2)));
      });
    });

    describe('BidRejected', async () => {

      let events;
      beforeEach(async () => {
        await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
        const {logs} = await this.auction.rejectBid(editionNumber1, {from: artistAccount1});
        events = logs;
      });

      it('BidderRefunded event populated', async () => {
        events[0].event.should.be.equal('BidderRefunded');
        let {_bidder, _editionNumber, _amount} = events[0].args;
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });

      it('BidPlaced event populated', async () => {
        events[1].event.should.be.equal('BidRejected');
        let {_caller, _bidder, _editionNumber, _amount} = events[1].args;
        _caller.should.be.equal(artistAccount1);
        _bidder.should.be.equal(bidder1);
        _editionNumber.should.be.eq.BN(editionNumber1);
        _amount.should.be.eq.BN(this.minBidAmount);
      });
    });

  });

  describe('rejecting bibs', async () => {
    beforeEach(async () => {
      // Setup controller account for edition in auction
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
    });

    it('when auction is open', async () => {
      await this.auction.placeBid(editionNumber1,  this.minBidAmount, {from: bidder1});
      let details = await this.auction.highestBidForEdition(editionNumber1);
      details[0].should.be.equal(bidder1);
      details[1].should.be.eq.BN(this.minBidAmount);

      await this.auction.rejectBid(editionNumber1, {from: artistAccount1});
      details = await this.auction.highestBidForEdition(editionNumber1);
      details[0].should.be.equal(ZERO_ADDRESS);
      details[1].should.be.eq.BN(0);
    });

  });

  describe('artists can enable editions themselves', async () => {

    let setupEvent;
    beforeEach(async () => {
      const {logs} = await this.auction.enableEditionForArtist(editionNumber1, {from: artistAccount1});
      setupEvent = logs;
    });

    it('should fail is trying to setup again', async () => {
      await assertRevert(this.auction.enableEditionForArtist(editionNumber1, {from: artistAccount1}));
    });

    it('AuctionEnabled', async () => {
      setupEvent[0].event.should.be.equal('AuctionEnabled');
      let {_editionNumber, _auctioneer} = setupEvent[0].args;
      _auctioneer.should.be.equal(artistAccount1);
      _editionNumber.should.be.eq.BN(editionNumber1);
    });

    it('should be enabled', async () => {
      let isEditionEnabled = await this.auction.isEditionEnabled(editionNumber1);
      isEditionEnabled.should.be.equal(true);
    });

    it('should have an edition controller', async () => {
      let editionController = await this.auction.editionController(editionNumber1);
      editionController.should.be.equal(artistAccount1);
    });

    it('should not have a highest bid yet', async () => {
      let details = await this.auction.highestBidForEdition(editionNumber1);
      details[0].should.be.equal(ZERO_ADDRESS);
      details[1].should.be.eq.BN(0);
    });

  });

  describe('can query for a list of editions added to auctions', async () => {

    beforeEach(async () => {
      await this.auction.setArtistsControlAddressAndEnabledEdition(editionNumber1, artistAccount1, {from: _owner});
      await this.auction.setArtistsControlAddressAndEnabledEdition(100200, artistAccount1, {from: _owner});
      await this.auction.setArtistsControlAddressAndEnabledEdition(100300, artistAccount1, {from: _owner});
    });

    it('the list is populated', async () => {
      const results = await this.auction.addedEditions();
      results.map(r => r.toString()).should.be.deep.equal(["100000", "100200", "100300"]);
    });
  });
});

