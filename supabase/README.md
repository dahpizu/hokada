# Supabase database changes

Database changes belong in `supabase/migrations` and should be reviewed and
applied through the Supabase CLI before deployment.

This repository did not include a schema snapshot or a database connection URL
when migrations were introduced. The migration here is deliberately limited to
the verified delivery invariant; it is not a replacement for a full schema and
RLS-policy baseline. Create that baseline from the linked project with
`supabase db pull` once the project database is linked and its schema can be
reviewed.

Link the project once with `supabase link --project-ref fzyyaurykybzmislnzlg`,
then apply reviewed migrations with `supabase db push`. These commands require a
Supabase CLI installation and the database password. Never put service-role
keys or database passwords in migration files.
