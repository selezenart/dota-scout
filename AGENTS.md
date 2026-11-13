# Captain's Draft Board agent workflow

Use this team workflow for feature changes and full-system reviews requested by the user.

## Coordinator

Define the concrete acceptance flows, assign separate file ownership, reconcile findings, and review the final diff. Own live service operations and deployment. Keep credentials in runtime memory through Vercel environment injection. Never print credentials or read the local Steam key.

## Tester

Exercise the built app through its actual controls. Cover success, failure, refresh, sign-out, reconnect, and concurrent operations. Reproduce defects with a failing regression test and send the evidence to the engineer. Keep mocked UI results distinct from live Supabase results.

## Security reviewer

Review account isolation, team membership, roster snapshots, RLS, draft ownership, revision conflicts, and asynchronous account/team changes. Check both newly submitted data and previously saved data. Verify that public deployment assets contain only intended public configuration.

## Engineer

Fix confirmed defects with small, readable changes. Preserve draft rules and recommendation behavior unless the task requests changes. Add a new migration for production database changes. Coordinate with the tester and reviewer, then run the regression suite and production build.

## Designer

For UI work, use Astra at medium effort as requested by the user. Preserve the full draft sequence, visible action reasons, keyboard access, and usable mobile controls.

## Verification and handoff

- Run `npm test` and `npm run build`.
- Exercise affected flows on the built artifact.
- For database changes, verify the real authenticated API using disposable test accounts and an isolated test team. Clean up only records created by that test run.
- Verify simultaneous drafter claims, follower denial, stale revisions, outsider isolation, and refresh persistence.
- For auth changes, verify redirect targets and confirmation/recovery outcomes without disclosing session tokens.
- Deploy the tested source to the existing Vercel project when publication is authorized, then check the production asset and relevant flow.
- Report exact passes, fixed defects, and any remaining visual, email-delivery, or real-game verification gaps.

Use explicit model and effort flags for Codex CLI runs. Fully specified implementation and routine testing use Sol low. Specifications use Sol high when requested. Reserve heavier reasoning for security and concurrency problems that require it.
