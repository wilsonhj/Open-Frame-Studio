import { CardsBoard } from "../../components/cards/cards-board";

export default function CardsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Marketplace Cards</h1>
        <p className="max-w-2xl text-muted">
          Upload one product photo. We cut it out, place it at 85% fill on a pure #FFFFFF 2000×2000 canvas and run the
          Amazon main-image checks. Secondary and A+ images come next, conditioned on this main image.
        </p>
      </div>
      <CardsBoard />
    </div>
  );
}
