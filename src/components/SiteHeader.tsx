import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import logoCompleta from "@/assets/logo-empuria-completa.png";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const { isLoading, isStaff, isMember } = useCurrentUser();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const accessDestination = isLoading
    ? "/login"
    : isStaff
      ? "/admin"
      : isMember
        ? "/portal"
        : "/login";
  const accessLabel = isLoading
    ? "Portal / Login"
    : isStaff
      ? "Painel Admin"
      : isMember
        ? "Meu Portal"
        : "Portal / Login";

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--brown)]/95 backdrop-blur-md border-b border-yellow-brand/20"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center group" aria-label="Instituto Empuria">
          <img src={logoCompleta} alt="Instituto Empuria" className="h-9 w-auto object-contain" />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-body text-offwhite/90">
          <a href="/#instituto" className="hover:text-yellow-brand transition">
            O Instituto
          </a>
          <a href="/#servicos" className="hover:text-yellow-brand transition">
            Serviços
          </a>
          <a href="/#conteudos" className="hover:text-yellow-brand transition">
            Conteúdos
          </a>
          <a href="/#contato" className="hover:text-yellow-brand transition">
            Contato
          </a>
        </nav>

        <Link
          to={accessDestination}
          className="hidden md:inline-flex items-center gap-2 bg-orange-brand hover:bg-red-brand text-offwhite px-5 py-2.5 rounded-md font-display font-semibold text-xs uppercase tracking-wider transition-all hover:shadow-warm"
        >
          {accessLabel}
        </Link>
      </div>
    </header>
  );
}
