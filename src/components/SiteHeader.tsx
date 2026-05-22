import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--brown)]/95 backdrop-blur-md border-b border-yellow-brand/20"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 rounded-full bg-yellow-brand flex items-center justify-center text-brown font-display font-extrabold">
            E
          </div>
          <div className="leading-none">
            <div className="font-display font-extrabold text-offwhite text-sm tracking-widest uppercase">
              Empuria
            </div>
            <div className="font-body italic text-yellow-brand/80 text-[10px]">
              Instituto · Madrid
            </div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-body text-offwhite/90">
          <a href="#instituto" className="hover:text-yellow-brand transition">O Instituto</a>
          <a href="#servicos" className="hover:text-yellow-brand transition">Serviços</a>
          <a href="#clube" className="hover:text-yellow-brand transition">Clube</a>
          <a href="#contato" className="hover:text-yellow-brand transition">Contato</a>
        </nav>

        <PortalButton />
      </div>
    </header>
  );
}

function PortalButton() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return (
    <Link
      to={authed ? "/portal" : "/login"}
      className="hidden md:inline-flex items-center gap-2 bg-orange-brand hover:bg-red-brand text-offwhite px-5 py-2.5 rounded-md font-display font-semibold text-xs uppercase tracking-wider transition-all hover:shadow-warm"
    >
      {authed ? "Meu Portal" : "Portal / Login"}
    </Link>);
}

function _End() {
  return (
    <>
      {null}
      </div>
    </header>
  );
}
