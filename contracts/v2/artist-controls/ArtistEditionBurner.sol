// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../forwarder/NativeMetaTransaction.sol";

interface INRDAV2ArtistBurner {
  function editionActive(uint256 _editionNumber) external view returns (bool);

  function artistCommission(uint256 _editionNumber) external view returns (address _artistAccount, uint256 _artistCommission);

  function updateActive(uint256 _editionNumber, bool _active) external;

  function totalSupplyEdition(uint256 _editionNumber) external view returns (uint256);

  function totalRemaining(uint256 _editionNumber) external view returns (uint256);

  function updateTotalAvailable(uint256 _editionNumber, uint256 _totalAvailable) external;
}

/**
* @title Artists burning contract for NotReal (NRDA)
*
* Allows for edition artists to burn unsold works or reduce the supply of sold tokens from editions
*
* https://www.notreal.ai/
*
* AMPLIFY ART.
*/
contract ArtistEditionBurner is 
Ownable, 
Pausable,
NativeMetaTransaction("ArtistEditionBurner")
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
  INRDAV2ArtistBurner public nrdaAddress;

  event EditionDeactivated(
    uint256 indexed _editionNumber
  );

  event EditionSupplyReduced(
    uint256 indexed _editionNumber
  );

  constructor(INRDAV2ArtistBurner _nrdaAddress) public {
    nrdaAddress = _nrdaAddress;
  }

  /**
   * @dev Sets the provided edition to either a deactivated state or reduces the available supply to zero
   * @dev Only callable from edition artists defined in NRDA NFT contract
   * @dev Only callable when contract is not paused
   * @dev Reverts if edition is invalid
   * @dev Reverts if edition is not active in KDOA NFT contract
   */
  function deactivateOrReduceEditionSupply(uint256 _editionNumber) external whenNotPaused {
    (address artistAccount, uint256 _) = nrdaAddress.artistCommission(_editionNumber);
    require(_msgSender() == artistAccount || _msgSender() == owner(), "Only from the edition artist account");

    // only allow them to be disabled if we have not already done it already
    bool isActive = nrdaAddress.editionActive(_editionNumber);
    require(isActive, "Only when edition is active");

    // only allow changes if not sold out
    uint256 totalRemaining = nrdaAddress.totalRemaining(_editionNumber);
    require(totalRemaining > 0, "Only when edition not sold out");

    // total issued so far
    uint256 totalSupply = nrdaAddress.totalSupplyEdition(_editionNumber);

    // if no tokens issued, simply disable the edition, burn it!
    if (totalSupply == 0) {
      nrdaAddress.updateActive(_editionNumber, false);
      nrdaAddress.updateTotalAvailable(_editionNumber, 0);
      emit EditionDeactivated(_editionNumber);
    }
    // if some tokens issued, reduce ths supply so that no more can be issued
    else {
      nrdaAddress.updateTotalAvailable(_editionNumber, totalSupply);
      emit EditionSupplyReduced(_editionNumber);
    }
  }

  /**
   * @dev Sets the NRDA address
   * @dev Only callable from owner
   */
  function setNrdavV2(INRDAV2ArtistBurner _nrdaAddress) onlyOwner public {
    nrdaAddress = _nrdaAddress;
  }

}
