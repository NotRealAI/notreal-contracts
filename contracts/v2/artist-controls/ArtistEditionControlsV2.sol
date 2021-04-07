// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../forwarder/NativeMetaTransaction.sol";

import "../interfaces/INRDAV2Controls.sol";

/**
* @title Artists self minting for NotReal (NRDA)
*
* Allows for the edition artists to mint there own assets and control the price of an edition
*
* https://www.notreal.ai/
*
* AMPLIFY ART.
*/
contract ArtistEditionControlsV2 is 
Ownable, 
Pausable,
NativeMetaTransaction("ArtistEditionControlsV2")
{

  function _msgSender()
  internal
  view
  override(Context, NativeMetaTransaction)
  returns (address payable sender) {
    return NativeMetaTransaction._msgSender();
  }

  using SafeMath for uint256;

  // Interface into the NRDA world
  INRDAV2Controls public nrdaAddress;

  event PriceChanged(
    uint256 indexed _editionNumber,
    address indexed _artist,
    uint256 _priceInWei
  );

  event EditionGifted(
    uint256 indexed _editionNumber,
    address indexed _artist,
    uint256 indexed _tokenId
  );

  event EditionDeactivated(
    uint256 indexed _editionNumber
  );

  bool public deactivationPaused = false;

  modifier whenDeactivationNotPaused() {
    require(!deactivationPaused);
    _;
  }

  constructor(INRDAV2Controls _nrdaAddress) public {
    nrdaAddress = _nrdaAddress;
  }

  /**
   * @dev Ability to gift new NFTs to an address, from a NRDA edition
   * @dev Only callable from edition artists defined in NRDA NFT contract
   * @dev Only callable when contract is not paused
   * @dev Reverts if edition is invalid
   * @dev Reverts if edition is not active in KDOA NFT contract
   */
  function gift(address _receivingAddress, uint256 _editionNumber)
  external
  whenNotPaused
  returns (uint256)
  {
    require(_receivingAddress != address(0), "Unable to send to zero address");

    (address artistAccount, uint256 _) = nrdaAddress.artistCommission(_editionNumber);
    require(_msgSender() == artistAccount || _msgSender() == owner(), "Only from the edition artist account");

    bool isActive = nrdaAddress.editionActive(_editionNumber);
    require(isActive, "Only when edition is active");

    uint256 tokenId = nrdaAddress.mint(_receivingAddress, _editionNumber);

    emit EditionGifted(_editionNumber, _msgSender(), tokenId);

    return tokenId;
  }

  /**
   * @dev Sets the price of the provided edition in the WEI
   * @dev Only callable from edition artists defined in NRDA NFT contract
   * @dev Only callable when contract is not paused
   * @dev Reverts if edition is invalid
   */
  function updateEditionPrice(uint256 _editionNumber, uint256 _priceInWei)
  external
  whenNotPaused
  returns (bool)
  {
    (address artistAccount, uint256 _) = nrdaAddress.artistCommission(_editionNumber);
    require(_msgSender() == artistAccount || _msgSender() == owner(), "Only from the edition artist account");

    nrdaAddress.updatePriceInWei(_editionNumber, _priceInWei);

    emit PriceChanged(_editionNumber, _msgSender(), _priceInWei);

    return true;
  }

  /**
   * @dev Sets provided edition to deactivated so it does not appear on the platform
   * @dev Only callable from edition artists defined in NRDA NFT contract
   * @dev Only callable when contract is not paused
   * @dev Reverts if edition is invalid
   * @dev Reverts if edition is not active in KDOA NFT contract
   */
  function deactivateEdition(uint256 _editionNumber)
  external
  whenNotPaused
  whenDeactivationNotPaused
  returns (bool)
  {
    (address artistAccount, uint256 _) = nrdaAddress.artistCommission(_editionNumber);
    require(_msgSender() == artistAccount || _msgSender() == owner(), "Only from the edition artist account");

    // Only allow them to be disabled if we have not already done it already
    bool isActive = nrdaAddress.editionActive(_editionNumber);
    require(isActive, "Only when edition is active");

    nrdaAddress.updateActive(_editionNumber, false);

    emit EditionDeactivated(_editionNumber);

    return true;
  }

  /**
   * @dev Sets the NRDA address
   * @dev Only callable from owner
   */
  function setNrdavV2(INRDAV2Controls _nrdaAddress) onlyOwner public {
    nrdaAddress = _nrdaAddress;
  }

  /**
   * @dev Disables the ability to deactivate editions from the this contract
   * @dev Only callable from owner
   */
  function pauseDeactivation() onlyOwner public {
    deactivationPaused = true;
  }

  /**
   * @dev Enables the ability to deactivate editions from the this contract
   * @dev Only callable from owner
   */
  function enablesDeactivation() onlyOwner public {
    deactivationPaused = false;
  }

}
