import { ComingSoon } from "../../components/coming-soon";
import { SURFACES } from "../../lib/brand";

export default function IdentityPage() {
  return (
    <ComingSoon title={SURFACES.identity.label}>
      Upload 5–20 photos of one person (8–12 is ideal). We check each photo, keep the best 3–6 crops as a reference
      set, and save it as a portable identity you can reuse in every other tool.
    </ComingSoon>
  );
}
