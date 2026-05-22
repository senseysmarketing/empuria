import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

// Simplified topographic Spain outline — single stroke for line-draw effect
const SPAIN_PATH =
  "M 30 80 Q 50 60 90 65 Q 130 55 170 60 Q 210 50 250 65 Q 280 75 290 100 Q 295 130 270 150 Q 240 165 200 160 Q 160 170 120 165 Q 80 170 50 155 Q 25 135 30 105 Z";

export function SuccessFinale({ firstName, onClose }: { firstName: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-4 space-y-5">
      <motion.svg
        viewBox="0 0 320 200"
        className="w-48 h-32 text-orange-brand"
        initial="hidden"
        animate="visible"
      >
        <motion.path
          d={SPAIN_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          variants={{
            hidden: { pathLength: 0, opacity: 0 },
            visible: {
              pathLength: 1,
              opacity: 1,
              transition: { pathLength: { duration: 1.6, ease: "easeOut" }, opacity: { duration: 0.3 } },
            },
          }}
        />
        {/* inner topo lines */}
        {[0.7, 0.55, 0.4].map((s, i) => (
          <motion.path
            key={i}
            d={SPAIN_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeOpacity={0.35}
            transform={`translate(${160 * (1 - s)} ${100 * (1 - s)}) scale(${s})`}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.6, delay: 0.3 + i * 0.2, ease: "easeOut" }}
          />
        ))}
      </motion.svg>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4, duration: 0.5 }}
        className="font-display font-bold text-2xl md:text-3xl text-brown"
      >
        Tudo certo, {firstName}! Recebemos seu dossiê.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.7, duration: 0.5 }}
        className="font-body italic text-base text-brown/70 max-w-md"
      >
        Nossa equipe fará a triagem inicial e entrará em contato pelo WhatsApp em até 24 horas.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.1, duration: 0.4 }}
      >
        <Button
          onClick={onClose}
          variant="ghost"
          className="text-brown/60 hover:text-brown font-display uppercase tracking-widest text-xs"
        >
          Fechar
        </Button>
      </motion.div>
    </div>
  );
}
