const getGasCosts = require('../../../helpers/getGasCosts');
const addEditionCreators = require('../../../helpers/nrda');
const getTokenBalance = require('../../../helpers/getTokenBalance');
let getBalance;
const toBN = require('../../../helpers/toBN');
const assertRevert = require('../../../helpers/assertRevert');
const etherToWei = require('../../../helpers/etherToWei');
const {duration, increaseTo, advanceBlock, latest} = require('../../../helpers/time');
const bnChai = require('bn-chai');

const _ = require('lodash');

const NotRealDigitalAssetV2 = artifacts.require('NotRealDigitalAssetV2');
const TokenMarketplaceV2 = artifacts.require('TokenMarketplaceV2');
const ERC20Mock = artifacts.require('ERC20Mock');

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(web3.utils.BN))
  .should();

contract('TokenMarketplaceV2 tests', function (accounts) {

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  const _owner = accounts[0];
  const nrCommission = accounts[1];

  const artistAccount = accounts[2];
  const optionalArtistAccount = accounts[3];

  const bidder1 = accounts[4];
  const bidder2 = accounts[5];
  const bidder3 = accounts[6];

  const owner1 = accounts[7];
  const owner2 = accounts[8];
  const owner3 = accounts[9];

  const editionNumber1 = 100000;
  const editionNumber2 = 200000;
  const editionNumber3 = 300000;
  const editionType = 1;
  const editionData = web3.utils.asciiToHex("editionData");
  const tokenUri = "edition1";
  const editionPrice = etherToWei(0.1);

  const artistCommission = toBN(85);
  const totalAvailable = 5;

  const artistCommissionSplit = toBN(43);
  const optionalCommissionSplit = toBN(42);

  const _1_token1 = 100001;
  const _1_token2 = 100002;
  const _1_token3 = 100003;

  const _2_token1 = 200001;
  const _2_token2 = 200002;
  const _2_token3 = 200003;

  const _3_token1 = 300001;

  before(async () => {
    // Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock();
    //this.latest = (await latest())
  });

  beforeEach(async () => {
    // Create contracts
    this.erc20 = await ERC20Mock.new('Token', 'MTKN', _owner, 0, {from:_owner});
    getBalance = getTokenBalance(this.erc20);


    this.nrda = await NotRealDigitalAssetV2.new(this.erc20.address, {from: _owner});
    addEditionCreators(this.nrda);
    this.marketplace = await TokenMarketplaceV2.new(this.nrda.address, _owner, this.erc20.address, {from: _owner});


    await Promise.all(accounts.slice(0,10).map(async acct => {
      await this.erc20.mint(acct, etherToWei(9999), { from: _owner })
      await this.erc20.approve(this.marketplace.address, etherToWei(9999), {from: acct});
    }))

    // Update the commission account to be something different than owner
    await this.marketplace.setNrCommissionAccount(nrCommission, {from: _owner});

    // Grab the min bid amount
    this.minBidAmount = toBN(await this.marketplace.minBidAmount());
  });

  beforeEach(async () => {
    // Create a new edition
    await this.nrda.createActiveEdition(editionNumber1, editionData, editionType, 0, 0, artistAccount, artistCommission, editionPrice, tokenUri, totalAvailable, {from: _owner});

    // Create a new edition with split commission
    await this.nrda.createActiveEdition(editionNumber2, editionData, editionType, 0, 0, artistAccount, artistCommissionSplit, editionPrice, tokenUri, totalAvailable, {from: _owner});


    // Create new edition with timed mint belonging to artist
    //const startDate = this.latest;
    //const endDate   = this.latest + duration.hours(24);
    this.startDate = (await latest());
    this.endDate = this.startDate + duration.hours(24);
    await this.nrda.createActiveEdition(editionNumber3, editionData, editionType, this.startDate, this.endDate, artistAccount, artistCommission, editionPrice, tokenUri, totalAvailable, {from: _owner});

    await this.nrda.updateOptionalCommission(editionNumber2, optionalCommissionSplit, optionalArtistAccount, {from: _owner});

    // Give each owner a token
    await this.nrda.mint(owner1, editionNumber1, {from: _owner});
    await this.nrda.mint(owner2, editionNumber1, {from: _owner});
    await this.nrda.mint(owner3, editionNumber1, {from: _owner});

    // Give each owner a token
    await this.nrda.mint(owner1, editionNumber2, {from: _owner});
    await this.nrda.mint(owner2, editionNumber2, {from: _owner});
    await this.nrda.mint(owner3, editionNumber2, {from: _owner});

    // Give artist their own token
    await this.nrda.mint(artistAccount, editionNumber3, {from: _owner});

    // Set all owners to approve all on the marketplace
    await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: owner1});
    await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: owner2});
    await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: owner3});
    await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: artistAccount});

    // Set updated commission splits
    await this.marketplace.setArtistRoyaltyPercentage(50, {from: _owner});
    await this.marketplace.setPlatformPercentage(30, {from: _owner});
  });

  describe('constructed properly', async () => {
    it('owner is set', async () => {
      let owner = await this.marketplace.owner();
      owner.should.be.equal(_owner);
    });

    it('NRDA address is set', async () => {
      let nrdaAddress = await this.marketplace.nrdaAddress();
      nrdaAddress.should.be.equal(this.nrda.address);
    });

    it('min bid is set', async () => {
      let minBidAmount = await this.marketplace.minBidAmount();
      minBidAmount.should.be.eq.BN(etherToWei(0.04));
    });

    it('ko percentage set', async () => {
      let platformFeePercentage = await this.marketplace.platformFeePercentage();
      platformFeePercentage.should.be.eq.BN("30");
    });

    it('artists royalties percentage set', async () => {
      let artistRoyaltyPercentage = await this.marketplace.artistRoyaltyPercentage();
      artistRoyaltyPercentage.should.be.eq.BN("50");
    });

    it('nrCommissionAccount set', async () => {
      let nrCommissionAccount = await this.marketplace.nrCommissionAccount();
      nrCommissionAccount.should.be.equal(nrCommission);
    });
  });

  describe('Placing a bid', async () => {

    it('fails for invalid token ID', async () => {
      await assertRevert(
        this.marketplace.placeBid(9999,  this.minBidAmount, {from: bidder1}),
        'Token does not exist'
      );
    });

    it('fails if contract paused', async () => {
      await this.marketplace.pause({from: _owner});
      await assertRevert(
        this.marketplace.placeBid(9999,  this.minBidAmount, {from: bidder1})
      );
    });

    it('fails if less than minimum bid amount', async () => {
      await assertRevert(
        this.marketplace.placeBid(_1_token1,  etherToWei(0.01), {from: bidder1}),
        "Offer not enough"
      );
    });

    it('fails if token is disabled from offers', async () => {
      await this.marketplace.disableAuction(_1_token1, {from: _owner});
      await assertRevert(
        this.marketplace.placeBid(_1_token1,  this.minBidAmount, {from: bidder1}),
        "Token not enabled for offers"
      );
    });

    it('fails if owned by artist and outside of mint window', async () => {
      // Auction is 24 hours, fast-forward past end date
      await increaseTo(this.startDate + duration.days(5));
      await assertRevert(
        this.marketplace.placeBid(_3_token1,  this.minBidAmount, {from: bidder1}),
        "Token owned by artist outside of minting window"
      );
    });


    const placeBidTests = async (setup, token, tokenOwner, acceptBid) => {
        setup()

        it('offer is placed', async () => {
          const {_bidder, _offer, _owner, _enabled, _paused} = await this.marketplace.tokenOffer(token);
          _bidder.should.be.equal(bidder1);
          _offer.should.be.eq.BN(this.minBidAmount);
          _owner.should.be.equal(tokenOwner);
          _enabled.should.be.equal(true);
          _paused.should.be.equal(false);
        });

        it('the contract balance is updated', async () => {
          let auctionBalance = await getBalance(this.marketplace.address);
          auctionBalance.should.be.eq.BN(this.minBidAmount);
        });

        describe('and then being out bid', async () => {

          beforeEach(async () => {
            this.newBidAmount = this.minBidAmount.mul(toBN(2));
            this.bidder1Balance = await getBalance(bidder1);
            await this.marketplace.placeBid(token,  this.newBidAmount, {from: bidder2});
          });

          it('the original bidder is refunded', async () => {
            const postBidBidder1Balance = await getBalance(bidder1);
            postBidBidder1Balance.should.be.eq.BN(
              this.bidder1Balance.add(this.minBidAmount)
            );
          });

          it('the contract balance is updated', async () => {
            let auctionBalance = await getBalance(this.marketplace.address);
            auctionBalance.should.be.eq.BN(this.newBidAmount);
          });

          it('the new offer is placed', async () => {
            const {_bidder, _offer, _owner, _enabled, _paused} = await this.marketplace.tokenOffer(token);
            _bidder.should.be.equal(bidder2);
            _offer.should.be.eq.BN(this.newBidAmount);
            _owner.should.be.equal(tokenOwner);
            _enabled.should.be.equal(true);
            _paused.should.be.equal(false);
          });

          describe('then the bid is accepted', async () => {

            beforeEach(async () => {
              this.bidder2Balance = await getBalance(bidder2);
              this.tokenOwnerBalance = await getBalance(tokenOwner);
              this.marketplaceBalance = await getBalance(this.marketplace.address);
              this.nrCommissionBalance = await getBalance(nrCommission);
              this.artistAccountBalance = await getBalance(artistAccount);


              this.gas = {}
              let tx = await acceptBid();

              //this.gas = {}
              //let tx = await this.marketplace.acceptBid(token, this.newBidAmount, {from: bidAccepter});
              //this.gas[bidAccepter] = await getGasCosts(tx);

              this.bidder2PostBalance = await getBalance(bidder2);
              this.tokenOwnerPostBalance = await getBalance(tokenOwner);
              this.marketplacePostBalance = await getBalance(this.marketplace.address);
              this.nrCommissionPostBalance = await getBalance(nrCommission);
              this.artistAccountPostBalance = await getBalance(artistAccount);

              console.log("bidder2PostBalance", this.bidder2PostBalance.toString());
              console.log("tokenOwnerPostBalance", this.tokenOwnerPostBalance.toString());
              console.log("marketplacePostBalance", this.marketplacePostBalance.toString());
              console.log("nrCommissionPostBalance", this.nrCommissionPostBalance.toString());
              console.log("artistAccountPostBalance", this.artistAccountPostBalance.toString());

              if (tokenOwner == artistAccount) {
                this.tokenOwnerShare = 92 + 5
                this.artistShare     = 92 + 5
                this.nrShare         = 3
              } else {
                // Should get 92% of the funds
                this.tokenOwnerShare = 92
                this.artistShare     = 5
                this.nrShare         = 3
              }
            });

            it('bidder2 now owns the token', async () => {
              const owner = await this.nrda.ownerOf(token);
              owner.should.be.equal(bidder2);
            });

            it('owner balance goes up and does not own the token', async () => {
              // Does not own token
              const owner = await this.nrda.ownerOf(token);
              owner.should.not.be.equal(tokenOwner);

              this.tokenOwnerPostBalance.should.be.eq.BN(
                this.tokenOwnerBalance.add(
                  this.newBidAmount
                    .div(toBN(100)).mul(toBN(this.tokenOwnerShare))
                    .sub(this.gas[tokenOwner] || toBN(0)) // minus gas costs
                )
              );
            });

            it('nr commission account balance goes up', async () => {
              // Should get 3% of the funds
              this.nrCommissionPostBalance.should.be.eq.BN(
                this.nrCommissionBalance.add(
                  this.newBidAmount
                    .div(toBN(100)).mul(toBN(this.nrShare))
                )
              );
            });

            it('artist commission account balance goes up', async () => {
              // Should get 5% of the funds
              this.artistAccountPostBalance.should.be.eq.BN(
                this.artistAccountBalance.add(
                  this.newBidAmount
                    .div(toBN(100)).mul(toBN(this.artistShare))
                    .sub(this.gas[artistAccount] || toBN(0)) // minus gas costs
                )
              );
            });

            it('marketplace balance is cleared', async () => {
              this.marketplacePostBalance.should.be.eq.BN("0");
            });

          });

        });
    };


    describe('when a bid is placed', async () => {
      const token = _1_token1;
      const tokenOwner = owner1;

      const setup = () => {
        beforeEach(async () => {
          await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        })
      }

      const acceptBid = async () => {
        let tx = await this.marketplace.acceptBid(token, this.newBidAmount, {from: tokenOwner});
        // Turning off gas costs because we use ERC20 token now
        //this.gas[tokenOwner] = await getGasCosts(tx);
        return tx
      }

      placeBidTests(setup, token, tokenOwner, acceptBid);
    });

    describe('when a mint bid is placed', async () => {
      const token = _3_token1;
      const tokenOwner = artistAccount;

      const setup = () => {
        beforeEach(async () => {
          await increaseTo(this.startDate + duration.hours(2))
          await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        })
      }

      const acceptBid = async () => {
        let tx = await this.marketplace.acceptBid(token, this.newBidAmount, {from: tokenOwner});
        //this.gas[tokenOwner] = await getGasCosts(tx);
        return tx
      }

      placeBidTests(setup, token, tokenOwner, acceptBid);
    });

    describe('when a mint bid is placed and acceptBid by winning bidder', async () => {
      const token = _3_token1;
      const tokenOwner = artistAccount;

      const setup = () => {
        beforeEach(async () => {
          await increaseTo(this.startDate + duration.hours(2))
          await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        })
      }

      const acceptBid = async () => {
        await increaseTo(this.startDate + duration.hours(48))
        let tx = await this.marketplace.acceptBid(token, this.newBidAmount, {from: bidder2});
        //this.gas[bidder2] = await getGasCosts(tx);
        return tx
      }

      placeBidTests(setup, token, tokenOwner, acceptBid);
    });


    // Anyone can call accept bid for a mint token, 
    // but will always be transferred to the owners regardless
    // If a 3rd party calls it, they are just paying the gas with no benefit to them
    describe('when a mint bid is placed and acceptBid by 3rd party', async () => {
      const token = _3_token1;
      const tokenOwner = artistAccount;

      const setup = () => {
        beforeEach(async () => {
          await increaseTo(this.startDate + duration.hours(2))
          await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        })
      }

      const acceptBid = async () => {
        await increaseTo(this.startDate + duration.hours(48))
        let tx = await this.marketplace.acceptBid(token, this.newBidAmount, {from: bidder3});
        //this.gas[bidder3] = await getGasCosts(tx);
        return tx
      }

      placeBidTests(setup, token, tokenOwner, acceptBid);
    });

    describe('when a mint bid is placed and minter receives royalties', async () => {
      const token = _3_token1;
      const tokenOwner = artistAccount;

      it('sends royalty to the minter', async () => {
        this.preBalance = {}
        this.postBalance = {}
        this.curBalance = {}
        this.gas = {[bidder1]: toBN(0)}
        let tx;

        this.preBalance[bidder1] = await getBalance(bidder1);

        // Setup
        await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: bidder1});
        tx = await this.nrda.setApprovalForAll(this.marketplace.address, true, {from: bidder2});
        //this.gas[bidder1].iadd(await getGasCosts(tx));

        curBalance[bidder1] = (this.preBalance[bidder1]).sub(this.gas[bidder1]);
        (await getBalance(bidder1)).should.be.eq.BN(curBalance[bidder1]);


        // Place Bid
        await increaseTo(this.startDate + duration.hours(2))
        tx = await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        //this.gas[bidder1].iadd(await getGasCosts(tx));

        curBalance[bidder1] = (this.preBalance[bidder1]).sub(this.gas[bidder1]).sub(this.minBidAmount);
        (await getBalance(bidder1)).should.be.eq.BN(curBalance[bidder1]);


        // Minter (bidder1) accepts bid
        await increaseTo(this.startDate + duration.hours(48))
        tx = await this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder1});
        //this.gas[bidder1].iadd(await getGasCosts(tx));

        curBalance[bidder1] = (this.preBalance[bidder1]).sub(this.gas[bidder1]).sub(this.minBidAmount);
        (await getBalance(bidder1)).should.be.eq.BN(curBalance[bidder1]);


        // Minter sells their token
        await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder2});
        tx = await this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder1});
        //this.gas[bidder1].iadd(await getGasCosts(tx));

        // 100 - artistShare - nrShare = 92
        let ownerAmount = this.minBidAmount.div(toBN(100)).mul(toBN(92)); // 92%
        curBalance[bidder1] = this.preBalance[bidder1]
          .sub(this.gas[bidder1])
          .sub(this.minBidAmount)
          .add(ownerAmount);
        (await getBalance(bidder1)).should.be.eq.BN(curBalance[bidder1]);
  

        // 3rd party sells token, minter gets a royalty
        await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder3});
        await this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder2});

        let minterRoyaltyAmount = this.minBidAmount.div(toBN(100)).mul(toBN(2)); // 92%
        curBalance[bidder1] = this.preBalance[bidder1]
          .sub(this.gas[bidder1])
          .sub(this.minBidAmount)
          .add(ownerAmount)
          .add(minterRoyaltyAmount);
          
        (await getBalance(bidder1)).should.be.eq.BN(curBalance[bidder1]);

      })

      //it('sends royalty to minter', async () => {
      //  // bidder1 spent minBid, then gained minBid, resulting in a wash
      //  // They should only end up ahead the royalty amount, minus gas costs
      //  this.postBalance[bidder1].should.be.eq.BN(
      //    this.preBalance[bidder1].add(
      //      this.minBidAmount
      //        .div(toBN(100)).mul(toBN(2)) // 92% + 2% royalty
      //        .sub(this.gas[bidder1]) // minus gas costs
      //    )
      //  );
      //})
    });


    describe('when a non-mint bid is placed and acceptBid is called', async () => {
      const token = _1_token1;
      const tokenOwner = owner1;

      beforeEach(async () => {
        await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
      })

      it('allows bid acceptance from token owner', async () => {
        await this.marketplace.acceptBid(token, this.minBidAmount, {from: tokenOwner});
        const owner = await this.nrda.ownerOf(token);
        owner.should.be.equal(bidder1);
      })

      it('does not allow bid acceptance from high bidder', async () => {
        assertRevert(
          this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder1}),
          'Must be owned by artist and after mint window'
        )
      })

      it('does not allow bid acceptance from 3rd party', async () => {
        assertRevert(
          this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder3}),
          'Must be owned by artist and after mint window'
        )
      })
    });

    describe('when a mint bid is placed and acceptBid before mint window is over', async () => {
      const token = _3_token1;
      const tokenOwner = artistAccount;

      beforeEach(async () => {
        await increaseTo(this.startDate + duration.hours(2))
        await this.marketplace.placeBid(token,  this.minBidAmount, {from: bidder1});
        await increaseTo(this.startDate + duration.hours(6))
      })

      it('allows bid acceptance before mint window over from token owner', async () => {
        await this.marketplace.acceptBid(token, this.minBidAmount, {from: tokenOwner});
        const owner = await this.nrda.ownerOf(token);
        owner.should.be.equal(bidder1);
      })

      it('does not allow bid acceptance before mint window over from high bidder', async () => {
        assertRevert(
          this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder1}),
          'Must be owned by artist and after mint window'
        )
      })

      it('does not allow bid acceptance before mint window over from 3rd party', async () => {
        assertRevert(
          this.marketplace.acceptBid(token, this.minBidAmount, {from: bidder3}),
          'Must be owned by artist and after mint window'
        )
      })

    });

  });

  describe('Placing a bid on an edition with multiple collaborators', async () => {

    beforeEach(async () => {
      this.minBidAmount = etherToWei(1);
      await this.marketplace.placeBid(_2_token1,  this.minBidAmount, {from: bidder1});
    });

    it('offer is placed', async () => {
      const {_bidder, _offer, _owner, _enabled, _paused} = await this.marketplace.tokenOffer(_2_token1);
      _bidder.should.be.equal(bidder1);
      _offer.should.be.eq.BN(this.minBidAmount);
      _owner.should.be.equal(owner1);
      _enabled.should.be.equal(true);
      _paused.should.be.equal(false);
    });

    it('should determineSaleValues() correctly', async () => {
      const {_sellerTotal, _platformFee, _royaltyFee} = await this.marketplace.determineSaleValues(_2_token1);
      _sellerTotal.should.be.eq.BN(etherToWei(0.92)); // 92%
      _platformFee.should.be.eq.BN(etherToWei(0.03)); // 3%
      _royaltyFee.should.be.eq.BN(etherToWei(0.05)); // 5%
    });

    describe('when the owner accepts the bid', async () => {

      beforeEach(async () => {
        this.bidder1Balance = await getBalance(bidder1);
        this.owner1Balance = await getBalance(owner1);
        this.nrCommissionBalance = await getBalance(nrCommission);
        this.artistAccountBalance = await getBalance(artistAccount);
        this.optionalArtistAccountBalance = await getBalance(optionalArtistAccount);

        let tx = await this.marketplace.acceptBid(_2_token1, this.minBidAmount, {from: owner1});
        //this.txGasCosts = await getGasCosts(tx);
        this.txGasCosts = toBN(0);

        this.bidder1PostBalance = await getBalance(bidder1);
        this.owner1PostBalance = await getBalance(owner1);
        this.marketplacePostBalance = await getBalance(this.marketplace.address);
        this.nrCommissionPostBalance = await getBalance(nrCommission);
        this.artistAccountPostBalance = await getBalance(artistAccount);
        this.optionalArtistAccountPostBalance = await getBalance(optionalArtistAccount);

        console.log("bidder1PostBalance", this.bidder1PostBalance.toString());
        console.log("owner1PostBalance", this.owner1PostBalance.toString());
        console.log("marketplacePostBalance", this.marketplacePostBalance.toString());
        console.log("nrCommissionPostBalance", this.nrCommissionPostBalance.toString());
        console.log("artistAccountPostBalance", this.artistAccountPostBalance.toString());
        console.log("optionalArtistAccountPostBalance", this.optionalArtistAccountPostBalance.toString());
      });

      it('bidder2 now owns the token', async () => {
        const owner = await this.nrda.ownerOf(_2_token1);
        owner.should.be.equal(bidder1);
      });

      it('owner balance goes up and does not own the token', async () => {
        // Does not own token
        const owner = await this.nrda.ownerOf(_2_token1);
        owner.should.not.be.equal(owner1);

        // Should get 92% of the funds
        this.owner1PostBalance.should.be.eq.BN(
          this.owner1Balance.add(
            this.minBidAmount
              .div(toBN(100)).mul(toBN(92)) // 92%
              .sub(this.txGasCosts) // minus gas costs
          )
        );
      });

      it('ko commission account balance goes up', async () => {
        // Should get 3% of the funds
        this.nrCommissionPostBalance.should.be.eq.BN(
          this.nrCommissionBalance.add(
            this.minBidAmount
              .div(toBN(100)).mul(toBN(3)) // 3%
          )
        );
      });

      it('artist commission account balance goes up', async () => {
        this.artistAccountPostBalance.sub(this.artistAccountBalance)
          .should.be.eq.BN("25294117647058823"); // gained slightly more due to the 43/42 split
      });

      it('optional artist commission account balance goes up', async () => {
        this.optionalArtistAccountPostBalance.sub(this.optionalArtistAccountBalance)
          .should.be.eq.BN("24705882352941177");  // gained slightly less due to the 43/42 split
      });

      it('marketplace balance is cleared', async () => {
        this.marketplacePostBalance.should.be.eq.BN("0");
      });

    });

  });

  // Withdrawing a bid is disabled

  // describe('Withdrawing a bid', async () => {

  //   beforeEach(async () => {
  //     this.bidder1Balance = await getBalance(bidder1);
  //     let tx = await this.marketplace.placeBid(_1_token1,  this.minBidAmount, {from: bidder1});
  //     this.placeBidGasCosts = await getGasCosts(tx);
  //   });

  //   it('fails for invalid token ID', async () => {
  //     await assertRevert(
  //       this.marketplace.withdrawBid(9999, {from: bidder1}),
  //       'Token does not exist'
  //     );
  //   });

  //   it('fails if contract paused', async () => {
  //     await this.marketplace.pause({from: _owner});
  //     await assertRevert(
  //       this.marketplace.withdrawBid(_1_token1, {from: bidder1})
  //     );
  //   });

  //   it('fails if caller is not offer owner', async () => {
  //     await assertRevert(
  //       this.marketplace.withdrawBid(_1_token1, {from: bidder2}),
  //       'Not offer maker'
  //     );
  //   });

  //   describe('once withdrawn', async () => {

  //     beforeEach(async () => {
  //       let tx = await this.marketplace.withdrawBid(_1_token1, {from: bidder1});
  //       this.withdrawBidGasCosts = await getGasCosts(tx);
  //       this.bidder1PostBalance = await getBalance(bidder1);
  //     });

  //     it('bid is withdrawn correctly', async () => {
  //       // Only charged for GAS - balance before placing bid equals post withdrawing bid
  //       this.bidder1Balance.sub(this.bidder1PostBalance)
  //         .should.be.eq.BN(
  //         this.withdrawBidGasCosts.add(this.placeBidGasCosts)
  //       );
  //     });

  //     it('marketplace balance is cleared', async () => {
  //       (await getBalance(this.marketplace.address)).should.be.eq.BN("0");
  //     });

  //     it('token data is blank', async () => {
  //       const {_bidder, _offer, _owner, _enabled, _paused} = await this.marketplace.tokenOffer(_1_token1);
  //       _bidder.should.be.equal(ZERO_ADDRESS);
  //       _offer.should.be.eq.BN("0");
  //       _owner.should.be.equal(owner1);
  //       _enabled.should.be.equal(true);
  //       _paused.should.be.equal(false);
  //     });

  //   })

  // });

  describe('Rejecting a bid', async () => {

    beforeEach(async () => {
      this.bidder1Balance = await getBalance(bidder1);
      let tx = await this.marketplace.placeBid(_1_token1,  this.minBidAmount, {from: bidder1});
      //this.placeBidGasCosts = await getGasCosts(tx);
      this.placeBidGasCosts = toBN(0)
    });

    it('fails for invalid token ID', async () => {
      await assertRevert(
        this.marketplace.rejectBid(9999, {from: owner1}),
        'No offer open'
      );
    });

    it('fails if contract paused', async () => {
      await this.marketplace.pause({from: _owner});
      await assertRevert(
        this.marketplace.rejectBid(_1_token1, {from: owner1})
      );
    });

    it('fails if caller is not token owner', async () => {
      await assertRevert(
        this.marketplace.rejectBid(_1_token1, {from: owner2}),
        "Not token owner"
      );
    });

    it('fails if no offer open', async () => {
      await assertRevert(
        this.marketplace.rejectBid(_1_token2, {from: owner2}),
        "No offer open"
      );
    });

    describe('once rejected', async () => {

      beforeEach(async () => {
        let tx = await this.marketplace.rejectBid(_1_token1, {from: owner1});
        this.rejectBidGasCosts = await getGasCosts(tx);

        this.bidder1PostBalance = await getBalance(bidder1);
      });

      it('bid is withdrawn correctly', async () => {
        // Only charged for placing bid GAS - balance before placing bid equals post rejecting bid
        this.bidder1Balance.sub(this.bidder1PostBalance)
          .should.be.eq.BN(this.placeBidGasCosts);
      });

      it('marketplace balance is cleared', async () => {
        (await getBalance(this.marketplace.address)).should.be.eq.BN("0");
      });

      it('token data is blank', async () => {
        const {_bidder, _offer, _owner, _enabled, _paused} = await this.marketplace.tokenOffer(_1_token1);
        _bidder.should.be.equal(ZERO_ADDRESS);
        _offer.should.be.eq.BN("0");
        _owner.should.be.equal(owner1);
        _enabled.should.be.equal(true);
        _paused.should.be.equal(false);
      });

    })

  });

  describe('Accepting a bid', async () => {

    beforeEach(async () => {
      let tx = await this.marketplace.placeBid(_1_token2,  this.minBidAmount, {from: bidder1});
      this.placeBidGasCosts = await getGasCosts(tx);
    });

    it('fails for invalid token ID', async () => {
      await assertRevert(
        this.marketplace.acceptBid(9999, this.minBidAmount, {from: owner2}),
        "Not token owner"
      );
    });

    it('fails if contract paused', async () => {
      await this.marketplace.pause({from: _owner});
      await assertRevert(
        this.marketplace.acceptBid(_1_token2, this.minBidAmount, {from: owner1})
      );
    });

    it('fails if caller is not token owner', async () => {
      await assertRevert(
        this.marketplace.acceptBid(_1_token2, this.minBidAmount, {from: owner2}),
        "Not token owner"
      );
    });

    it('fails if no offer open', async () => {
      await assertRevert(
        this.marketplace.acceptBid(_1_token1, this.minBidAmount, {from: owner1}),
        "Offer amount not satisfied"
      );
    });

    describe('once accepted', async () => {

      beforeEach(async () => {
        // Tweak so optional is not only 5%
        await this.nrda.updateArtistCommission(editionNumber1, 76, {from: _owner});
        await this.nrda.updateOptionalCommission(editionNumber1, 9, optionalArtistAccount, {from: _owner});

        this.bidder1Balance = await getBalance(bidder1);
        this.owner2Balance = await getBalance(owner2);
        this.marketplaceBalance = await getBalance(this.marketplace.address);
        this.nrCommissionBalance = await getBalance(nrCommission);
        this.artistAccountBalance = await getBalance(artistAccount);
        this.optionalArtistAccountBalance = await getBalance(optionalArtistAccount);

        let tx = await this.marketplace.acceptBid(_1_token2, this.minBidAmount, {from: owner2});
        this.txGasCosts = toBN(0);
        //this.txGasCosts = await getGasCosts(tx);

        this.bidder1PostBalance = await getBalance(bidder1);
        this.owner2PostBalance = await getBalance(owner2);
        this.marketplacePostBalance = await getBalance(this.marketplace.address);
        this.nrCommissionPostBalance = await getBalance(nrCommission);
        this.artistAccountPostBalance = await getBalance(artistAccount);
        this.optionalArtistAccountPostBalance = await getBalance(optionalArtistAccount);

        console.log("bidder2PostBalance", this.bidder1PostBalance.toString());
        console.log("owner2PostBalance", this.owner2PostBalance.toString());
        console.log("marketplacePostBalance", this.marketplacePostBalance.toString());
        console.log("nrCommissionPostBalance", this.nrCommissionPostBalance.toString());
        console.log("artistAccountPostBalance", this.artistAccountPostBalance.toString());
      });

      it('bidder1 now owns the token', async () => {
        const owner = await this.nrda.ownerOf(_1_token2);
        owner.should.be.equal(bidder1);
      });

      it('owner balance goes up and does not own the token', async () => {
        // Does not own token
        const owner = await this.nrda.ownerOf(_1_token2);
        owner.should.not.be.equal(owner1);

        // Should get 92% of the funds
        this.owner2PostBalance.should.be.eq.BN(
          this.owner2Balance.add(
            this.minBidAmount
              .div(toBN(100)).mul(toBN(92)) // 95%
              .sub(this.txGasCosts) // minus gas costs
          )
        );
      });

      it('ko commission account balance goes up', async () => {
        // Should get 3% of the funds
        this.nrCommissionPostBalance.should.be.eq.BN(
          this.nrCommissionBalance.add(
            this.minBidAmount
              .div(toBN(100)).mul(toBN(3)) // 3%
          )
        );
      });

      it('artist commission account balance goes up', async () => {
        this.artistAccountPostBalance.sub(this.artistAccountBalance)
          .should.be.eq.BN("1788235294117647");
      });

      it('optional artist commission account balance goes up', async () => {
        this.optionalArtistAccountPostBalance.sub(this.optionalArtistAccountBalance)
          .should.be.eq.BN("211764705882353");
      });

      it('marketplace balance is cleared', async () => {
        this.marketplacePostBalance.should.be.eq.BN("0");
      });

    });

  });

  describe('should determineSaleValues() correctly', async () => {

    beforeEach(async () => {
      await this.marketplace.placeBid(_1_token2,  this.minBidAmount, {from: bidder1});
    });

  });

  describe('listing and buying tokens', async () => {

    describe('listing token', async () => {

      it('fails if not the owner', async () => {
        await assertRevert(
          this.marketplace.listToken(_1_token1, 0, {from: owner1}),
          "Listing price not enough"
        );
      });

      it('fails if price below min', async () => {
        await assertRevert(
          this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner2}),
          "Not token owner"
        );
      });

      it('successfully listed a token', async () => {
        await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

        const {_price, _lister, _currentOwner} = await this.marketplace.tokenListingDetails(_1_token1);
        _price.should.be.eq.BN(this.minBidAmount);
        _lister.should.be.equal(owner1);
        _currentOwner.should.be.equal(owner1);
      });

    });

    describe('delisting token', async () => {

      it('fails if no listing found', async () => {
        await assertRevert(
          this.marketplace.delistToken(_1_token1, {from: owner1}),
          "No listing found"
        );
      });

      it('fails if you dont currently own it', async () => {
        await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

        await assertRevert(
          this.marketplace.delistToken(_1_token1, {from: owner2}),
          "Only the current owner can delist"
        );
      });

      it('successfully listed a token', async () => {
        await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

        await this.marketplace.delistToken(_1_token1, {from: owner1});

        const {_price, _lister, _currentOwner} = await this.marketplace.tokenListingDetails(_1_token1);
        _price.should.be.eq.BN("0");
        _lister.should.be.equal(ZERO_ADDRESS);
        _currentOwner.should.be.equal(owner1);
      });

    });

    describe('buying tokens', async () => {

      it('fails when not listed', async () => {
        await assertRevert(
          this.marketplace.buyToken(_1_token1,  this.minBidAmount, {from: owner2}),
          "No listing found"
        );
      });

      it('fails when token ownership has changed', async () => {
        // list it
        await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

        // move it
        await this.nrda.transferFrom(owner1, owner3, _1_token1, {from: owner1});

        //attempt to buy it
        await assertRevert(
          this.marketplace.buyToken(_1_token1,  this.minBidAmount, {from: owner2}),
          "Listing not valid, token owner has changed"
        );
      });

      it('fails when buy price not valid', async () => {
        await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

        await assertRevert(
          this.marketplace.buyToken(_1_token1,  "0", {from: owner2}),
          "List price not satisfied"
        );
      });

      describe('successfully buying a token', async () => {

        beforeEach(async () => {
          // Tweak so optional is not only 5%
          await this.nrda.updateArtistCommission(editionNumber1, 76, {from: _owner});
          await this.nrda.updateOptionalCommission(editionNumber1, 9, optionalArtistAccount, {from: _owner});
        });

        it('transfers ownership', async () => {
          await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

          (await this.nrda.ownerOf(_1_token1)).should.be.equal(owner1);

          await this.marketplace.buyToken(_1_token1,  this.minBidAmount, {from: owner2});

          (await this.nrda.ownerOf(_1_token1)).should.be.equal(owner2);
        });

        describe('once purchased', async () => {

          beforeEach(async () => {
            // list it
            await this.marketplace.listToken(_1_token1, this.minBidAmount, {from: owner1});

            // checkmark balance
            this.owner1Balance = await getBalance(owner1);
            this.owner2Balance = await getBalance(owner2);
            this.marketplaceBalance = await getBalance(this.marketplace.address);
            this.nrCommissionBalance = await getBalance(nrCommission);
            this.artistAccountBalance = await getBalance(artistAccount);
            this.optionalArtistAccountBalance = await getBalance(optionalArtistAccount);

            // buy it
            let tx = await this.marketplace.buyToken(_1_token1,  this.minBidAmount, {from: owner2});
            this.txGasCosts = toBN(0)
            //this.txGasCosts = await getGasCosts(tx);

            this.owner1PostBalance = await getBalance(owner1);
            this.owner2PostBalance = await getBalance(owner2);
            this.marketplacePostBalance = await getBalance(this.marketplace.address);
            this.nrCommissionPostBalance = await getBalance(nrCommission);
            this.artistAccountPostBalance = await getBalance(artistAccount);
            this.optionalArtistAccountPostBalance = await getBalance(optionalArtistAccount);

            console.log("owner1PostBalance", this.owner1PostBalance.toString());
            console.log("owner2PostBalance", this.owner2PostBalance.toString());
            console.log("marketplacePostBalance", this.marketplacePostBalance.toString());
            console.log("nrCommissionPostBalance", this.nrCommissionPostBalance.toString());
            console.log("artistAccountPostBalance", this.artistAccountPostBalance.toString());
          });

          it('original owner balance goes up', async () => {
            // Should get 92% of the funds
            this.owner1PostBalance.should.be.eq.BN(
              this.owner1Balance.add(
                this.minBidAmount
                  .div(toBN(100)).mul(toBN(92)) // 95%
              )
            );
          });

          it('ko commission account balance goes up', async () => {
            // Should get 3% of the funds
            this.nrCommissionPostBalance.should.be.eq.BN(
              this.nrCommissionBalance.add(
                this.minBidAmount
                  .div(toBN(100)).mul(toBN(3)) // 3%
              )
            );
          });

          it('artist commission account balance goes up', async () => {
            this.artistAccountPostBalance.sub(this.artistAccountBalance)
              .should.be.eq.BN("1788235294117647");
          });

          it('optional artist commission account balance goes up', async () => {
            this.optionalArtistAccountPostBalance.sub(this.optionalArtistAccountBalance)
              .should.be.eq.BN("211764705882353");
          });
        });
      });

    });

  });

});

