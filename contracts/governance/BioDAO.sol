// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BioToken.sol";

/**
 * @title BioDAO
 * @notice Minimal voting-weight governance for BioLedger.
 *
 * Flow: propose → castVote → (voting period ends) → executeProposal
 *
 * Quorum:    4% of total supply
 * Threshold: 1% of total supply to create a proposal
 * Period:    50,400 blocks (~7 days at 12s/block)
 * Delay:     100 blocks between pass and execution
 */
contract BioDAO is AccessControl, ReentrancyGuard {

    BioToken public immutable token;

    uint256 public constant VOTING_PERIOD   = 50_400;
    uint256 public constant QUORUM_BPS      = 400;
    uint256 public constant THRESHOLD_BPS   = 100;
    uint256 public constant EXECUTION_DELAY = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    bytes32 public constant PROPOSER_ADMIN_ROLE = keccak256("PROPOSER_ADMIN_ROLE");

    enum ProposalState { Pending, Active, Defeated, Passed, Executed, Cancelled }

    struct Proposal {
        uint256 id;
        address proposer;
        address target;
        bytes   callData;
        string  description;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        bool    executed;
        bool    cancelled;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal)                     public proposals;
    mapping(uint256 => mapping(address => bool))     public hasVoted;

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address target,
        string  description,
        uint256 startBlock,
        uint256 endBlock
    );
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);

    constructor(address _token, address admin) {
        require(_token != address(0), "BioDAO: zero token");
        require(admin  != address(0), "BioDAO: zero admin");
        token = BioToken(_token);
        _grantRole(DEFAULT_ADMIN_ROLE,  admin);
        _grantRole(PROPOSER_ADMIN_ROLE, admin);
    }

    function propose(
        address target,
        bytes calldata callData,
        string calldata description
    ) external returns (uint256 proposalId) {
        require(target != address(0), "BioDAO: zero target");

        uint256 proposerVotes = token.getVotes(msg.sender);
        uint256 threshold     = (token.totalSupply() * THRESHOLD_BPS) / BPS_DENOMINATOR;
        require(proposerVotes >= threshold, "BioDAO: below proposal threshold");

        proposalId = ++proposalCount;

        proposals[proposalId] = Proposal({
            id:           proposalId,
            proposer:     msg.sender,
            target:       target,
            callData:     callData,
            description:  description,
            startBlock:   block.number,
            endBlock:     block.number + VOTING_PERIOD,
            forVotes:     0,
            againstVotes: 0,
            executed:     false,
            cancelled:    false
        });

        emit ProposalCreated(proposalId, msg.sender, target, description, block.number, block.number + VOTING_PERIOD);
    }

    function castVote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0,                         "BioDAO: proposal not found");
        require(block.number <= p.endBlock,         "BioDAO: voting ended");
        require(block.number >= p.startBlock,       "BioDAO: voting not started");
        require(!p.cancelled,                      "BioDAO: proposal cancelled");
        require(!hasVoted[proposalId][msg.sender],  "BioDAO: already voted");

        uint256 weight = token.getVotes(msg.sender);
        require(weight > 0, "BioDAO: no voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support) { p.forVotes += weight; }
        else         { p.againstVotes += weight; }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(state(proposalId) == ProposalState.Passed, "BioDAO: not passed");
        require(block.number >= p.endBlock + EXECUTION_DELAY, "BioDAO: execution delay not met");

        p.executed = true;

        (bool success, bytes memory returnData) = p.target.call(p.callData);
        if (!success) {
            if (returnData.length > 0) {
                assembly { revert(add(32, returnData), mload(returnData)) }
            }
            revert("BioDAO: execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0,      "BioDAO: proposal not found");
        require(!p.executed,    "BioDAO: already executed");
        require(
            msg.sender == p.proposer || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "BioDAO: not proposer or admin"
        );
        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0, "BioDAO: proposal not found");

        if (p.cancelled) return ProposalState.Cancelled;
        if (p.executed)  return ProposalState.Executed;
        if (block.number <= p.endBlock) return ProposalState.Active;

        uint256 quorum    = (token.totalSupply() * QUORUM_BPS) / BPS_DENOMINATOR;
        bool quorumMet    = (p.forVotes + p.againstVotes) >= quorum;
        bool majorityFor  = p.forVotes > p.againstVotes;

        if (quorumMet && majorityFor) return ProposalState.Passed;
        return ProposalState.Defeated;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        require(proposals[proposalId].id != 0, "BioDAO: not found");
        return proposals[proposalId];
    }
}