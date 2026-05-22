import logoCompleta from "@/assets/logo-empuria-completa.png";

export function SiteFooter() {
  return (
    <footer id="contato" className="bg-topo relative text-offwhite">
      <div className="absolute inset-0 bg-brown/85" />
      <div className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-4 gap-10">
          <div className="md:col-span-2">
            <img
              src={logoCompleta}
              alt="Instituto Empuria"
              className="h-12 w-auto object-contain"
            />
            <p className="font-body italic mt-4 text-offwhite/80 max-w-sm">
              A Embaixada Emocional do Brasileiro no Exterior.
            </p>
            <div className="mt-6 font-display text-sm uppercase tracking-widest text-yellow-brand">
              Gran Vía · Madrid · Espanha
            </div>
          </div>

          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-widest text-yellow-brand mb-4">
              Navegação
            </h4>
            <ul className="space-y-2 font-body text-offwhite/85 text-sm">
              <li><a href="#instituto" className="hover:text-yellow-brand">O Instituto</a></li>
              <li><a href="#servicos" className="hover:text-yellow-brand">Nossos Serviços</a></li>
              <li><a href="#clube" className="hover:text-yellow-brand">Clube da Imigração</a></li>
              <li><a href="#" className="hover:text-yellow-brand">Login do Portal</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-display font-bold text-sm uppercase tracking-widest text-yellow-brand mb-4">
              Fale Conosco
            </h4>
            <ul className="space-y-2 font-body text-offwhite/85 text-sm">
              <li>contato@empuria.es</li>
              <li>+34 600 000 000</li>
              <li>Seg–Sáb · 10h às 20h</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-6 border-t border-yellow-brand/20 flex flex-col md:flex-row justify-between gap-4 font-body text-xs text-offwhite/60">
          <div>Instituto Empuria © 2026. A Embaixada do Brasileiro.</div>
          <div className="italic">Feito com saudade, em Madrid.</div>
        </div>
      </div>
    </footer>
  );
}
