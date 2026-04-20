import { redirect } from "next/navigation";

export default function PrijsvoorstelPage() {
  // The legacy prijsvoorstel wizard has been replaced by the new CPQ flow.
  redirect("/offerte-samenstellen");
}
