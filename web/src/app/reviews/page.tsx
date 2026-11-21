import type { Metadata } from "next";
import { Reviews } from "@/components/Reviews";

export const metadata: Metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return <Reviews />;
}
