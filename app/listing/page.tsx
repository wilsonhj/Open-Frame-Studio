import { CardsBoard } from "../../components/cards/cards-board";
import { SURFACES } from "../../lib/brand";

/** Run ids are server-minted UUIDs; anything else in `?run=` is ignored. */
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;

export default async function ListingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // `/runs` links here as `?run=<id>` to reopen an earlier run.
  const run = (await searchParams).run;
  const runId = typeof run === "string" && RUN_ID.test(run) ? run : undefined;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{SURFACES.listing.label}</h1>
        <p className="max-w-2xl text-muted">
          Upload one product photo. We cut it out, place it at 85% fill on a pure #FFFFFF 2000×2000 canvas and run the
          marketplace hero-image checks. Pick a gallery, story or complete set to add panels built on that hero image; their
          text is drawn exactly as you type it.
        </p>
      </div>
      <CardsBoard runId={runId} />
    </div>
  );
}
