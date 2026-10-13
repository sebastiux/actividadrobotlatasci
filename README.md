# 🦅 Águila 5000 · Aprendizaje reforzado americanista

Práctica **Aprendizaje reforzado – Ejemplos de MDPs** (IBERO) adaptada a temática americanista:
el *Can Finder 5000* se convierte en el **Águila 5000**, el robot utilero que recoge balones en Coapa.

Sitio 100 % estático (HTML + CSS + JS modules, sin build) que explica e implementa de forma interactiva:

| Sección | Contenido |
|---|---|
| Planteamiento | Ciclo agente–entorno, objetivo del agente |
| MDP | Estados `S_H/S_L`, acciones buscar/esperar/recargar, tabla `p(s'|s,a)` y `r(s,a,s')`, grafo de transiciones en vivo |
| Teoría | Retorno descontado, γ, `v_π`, `q_π`, ecuaciones de Bellman (expectativa y optimalidad) aplicadas al robot |
| Evaluación de política | Solución exacta `(I − γP)⁻¹R` y barridos iterativos |
| Iteración de valor | Barrido a barrido con todas las cuentas de Bellman desglosadas |
| Iteración de política | Evaluar → mejorar, y las 6 políticas deterministas comparadas |
| Mapa de política | Acción óptima sobre rejillas α×β, β×r_w, β×γ |
| Monte Carlo | Episodio de muestra con cálculo de retornos `G_t` hacia atrás |
| SARSA / Q-learning | Una actualización TD “con lupa” para ambos métodos |
| Comparativa | MC vs SARSA vs Q-learning: recompensa por paso y RMSE contra `q*` |
| Simulador | El robot juega con distintas políticas sobre el grafo animado |

Todos los parámetros (α, β, r_s, r_w, castigo por rescate, γ) se ajustan desde el botón **⚙ Ajustar** y todo se recalcula en vivo.

## Despliegue automático

`.github/workflows/deploy.yml` publica el sitio en GitHub Pages en cada push a `main`/`master`/`claude/**`
(o manualmente con *Run workflow*).

Si el primer despliegue falla con *“Pages site not found”*, actívalo una sola vez:
**Settings → Pages → Build and deployment → Source: GitHub Actions**, y vuelve a correr el workflow.

## Correr en local

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

```
index.html          # contenido y secciones
css/styles.css      # tema americanista (claro/oscuro)
js/model.js         # dinámica del MDP
js/algorithms.js    # DP, Monte Carlo, SARSA, Q-learning
js/charts.js        # gráficas SVG sin dependencias
js/app.js           # interfaz
```
