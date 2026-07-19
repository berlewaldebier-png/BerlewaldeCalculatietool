import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type PageBackLinkProps = {
  href: string;
  label: string;
};

export function PageBackLink({ href, label }: PageBackLinkProps) {
  return (
    <nav className="page-back-navigation" aria-label="Terugnavigatie">
      <Link href={href} className="page-back-link">
        <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
        <span>{label}</span>
      </Link>
    </nav>
  );
}
