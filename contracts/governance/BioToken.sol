// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BioToken
 * @notice ERC20 governance token with vote delegation for BioLedger DAO.
 *         10,000,000 BIO minted to deployer on construction.
 *         Fixed supply — no mint function exposed.
 */
contract BioToken is ERC20Votes, ERC20Permit, Ownable {

    uint256 public constant INITIAL_SUPPLY = 10_000_000 * 10 ** 18;

    constructor(address initialHolder)
        ERC20("BioLedger Token", "BIO")
        ERC20Permit("BioLedger Token")
        Ownable(initialHolder)
    {
        require(initialHolder != address(0), "BioToken: zero holder");
        _mint(initialHolder, INITIAL_SUPPLY);
    }

    // Required overrides to resolve diamond inheritance between ERC20 and ERC20Votes

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, amount);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}