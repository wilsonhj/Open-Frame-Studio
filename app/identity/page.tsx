import { IdentityStudio } from "../../components/soul/identity-studio";
import { SURFACES } from "../../lib/brand";

export default function IdentityPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{SURFACES.identity.label}</h1>
        <p className="max-w-2xl text-muted">
          Upload 5–20 photos of one person (8–12 is ideal). We check each photo, keep the best 3–6 crops as a
          reference set, and save it as a portable identity you can reuse in every other tool. Only use photos of
          yourself or of someone who has given you permission.
        </p>
      </div>
      <IdentityStudio />
    </div>
  );
}
