import { ComingSoon } from "../../components/coming-soon";
import { SURFACES } from "../../lib/brand";

export default function ListingPage() {
  return (
    <ComingSoon title={SURFACES.listing.label}>
      A hero image on pure white, then gallery and story panels conditioned on it. Generate the hero alone, the
      gallery, the story panels, or the complete set.
    </ComingSoon>
  );
}
