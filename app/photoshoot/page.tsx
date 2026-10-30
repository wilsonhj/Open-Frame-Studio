import { ComingSoon } from "../../components/coming-soon";
import { SURFACES } from "../../lib/brand";

export default function PhotoshootPage() {
  return (
    <ComingSoon title={SURFACES.photoshoot.label}>
      Upload a product photo, pick one of ten shoot modes, and get a set of varied shots. Optionally put a
      saved identity in the frame.
    </ComingSoon>
  );
}
