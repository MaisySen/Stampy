# Loyalty migration prerequisite

`merchant-identities.pr5.sql` is an unmodified copy of
`server/auth/postgres/001-merchant-identities.sql` from Stampy PR #5,
commit `4d286a120206b087682860e3b36d715ba8bccf3a`.

SHA-256: `e41c3b49e1e3d8d5f290bb848614f9029ba2947c2dfc727b7f13da13d8398a70`

The regression test applies this actual prerequisite in an isolated local
PostgreSQL cluster before applying the PR #7 migration and runtime grants.
It is a test fixture, not a second production migration. Update the fixture
and provenance deliberately if the reviewed identity dependency changes.
