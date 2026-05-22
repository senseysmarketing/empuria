## Bug
No card de evento em `HomeEventsSection.tsx`, a `<img>` tem `group-hover:scale-105` mas o overlay de gradiente (`absolute inset-0 bg-gradient-to-t ...`) é um elemento irmão e fica estático. Quando a imagem cresce 5%, ela "sai" por baixo do gradiente, expondo uma faixa sem escurecimento entre o topo da imagem escalada e o topo do card — é o "espaço no meio" do print.

## Correção
Aplicar a mesma transformação de escala no overlay de gradiente, para que imagem e gradiente cresçam juntos e o degradê continue cobrindo toda a área visível.

Arquivo: `src/components/events/HomeEventsSection.tsx` (card do cenário A, dentro do `<Link>` do mapa `upcoming.map`).

Mudança pontual na div do gradiente:

```text
- <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/20 to-transparent" />
+ <div className="absolute inset-0 bg-gradient-to-t from-brown via-brown/20 to-transparent
+                 transition-transform duration-700 group-hover:scale-105" />
```

Nada mais muda: mesma duração/easing da imagem (`duration-700`), mesmo fator (`scale-105`), então os dois transformam em sincronia e o gap desaparece. Não altera o card de eventos passados (que usa grayscale, sem esse problema) nem afeta layout, acessibilidade ou tokens de design.