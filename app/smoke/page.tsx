import { JobRunner } from "../../components/job-runner";

export default function SmokePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Smoke test</h1>
        <p className="max-w-2xl text-muted">
          Uploads an image, runs <code>image_resize_smoke</code> (LoadImage → ImageScaleBy → SaveImage) and streams
          the output back through <code>/api/jobs/[id]/outputs/[outputId]</code>.
        </p>
      </div>
      <JobRunner />
    </div>
  );
}
