import { ComingSoon } from "../../components/coming-soon";
import { SURFACES } from "../../lib/brand";

export default function MotionPage() {
  return (
    <ComingSoon title={SURFACES.motion.label}>
      Combine a still of a saved identity and a product still into a short reference-to-video clip.
    </ComingSoon>
  );
}
