import { CardsBoard } from "../../components/cards/cards-board";
import { SURFACES } from "../../lib/brand";

export default function ListingPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{SURFACES.listing.label}</h1>
        <p className="max-w-2xl text-muted">
          Upload one product photo. We cut it out, place it at 85% fill on a pure #FFFFFF 2000×2000 canvas and run the
          marketplace hero-image checks. Gallery and story panels come next, conditioned on this hero image.
        </p>
      </div>
      <CardsBoard />
    </div>
  );
}
