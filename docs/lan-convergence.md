# LAN Convergence and Graded Attempts

## Contract

Local SQLite mutations advance persistent _sync_seq. Pull cursors carry seq plus legacy timestamp/rowid fields; a legacy cursor without seq rescans. Local sequence is never a portable conflict version. Ordinary rows compare (updated_at, _sync_rev, _sync_origin); revision and random origin break equal-time ties consistently. Metadata-only restoration does not create another business edit. Invalid explicit metadata rejects the transaction.

Deletion retains source deleted_at, rejects missing/blank/non-string remote times, and does not rewrite equal/older tombstones on replay. Older rows cannot resurrect through a newer tombstone. Global vocabulary lookup also recognizes legacy profile-named tombstones. Deletion remains timestamp-based: equal-time deletion wins.

wrong_stats.attempt_ledger version 1 stores a legacy baseline and a map from stable practice-session ID to [UTC timestamp, correct boolean]. Each question contributes once per newly graded session. Independent sessions union; shared-session delivery and repeat submission deduplicate. Totals, recent ten results, streak and last timestamps derive deterministically. Manual/business fields retain row conflict ordering. Baselines are selected deterministically, never blindly summed.

Windows regular database migration adds practice_sessions.sync_id so grading works before LAN is enabled. Android migration initializes the same identity before production grading.

## Compatibility and Limits

Upgrade all participating devices before exchanging graded statistics. A legacy peer with no ledger cannot safely overwrite an existing ledger and is explicitly rejected. Old independent aggregate counters cannot reconstruct historical attempts. Previously separate identities for a historically shared session are not automatically reconciled.

Per-question ledgers grow with attempts and remain subject to the 16 MiB sync batch boundary. Pagination/compaction is not implemented. Incoming numeric metadata and aggregate counts enforce safe-integer bounds; extraordinary local revision/sequence exhaustion has no separate database guard.

## Verification

Android: frontend/tests/lan-sync-convergence.mjs executes production serialization, merge and grading against SQLite. Windows: tests/test_sync_convergence.py covers corresponding production service paths. Tests include same-second edits, consumed-cursor mutation, causal changes, idempotent replay, migrations/rollback, tombstones and independent submissions.

Local automated checks are not device acceptance. New-package Android/Windows real TLS exchange, device storage migration and final visual acceptance must be verified separately before deployment is declared complete. No release or device installation is implied by this document.
