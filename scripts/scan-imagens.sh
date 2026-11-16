#!/usr/bin/env bash
# Scan de vulnerabilidades (CVEs) das imagens do projeto com Trivy, rodando em container.
# Uso: ./scripts/scan-imagens.sh [severidades]   (padrão: CRITICAL,HIGH,MEDIUM,LOW)
# Sai com código 1 se houver CRITICAL ou HIGH com correção disponível.

set -uo pipefail
cd "$(dirname "$0")/.."

# Trivy pinado por versão + digest
IMAGEM_TRIVY="aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb"
SEVERIDADES="${1:-CRITICAL,HIGH,MEDIUM,LOW}"
VOLUME_CACHE_TRIVY="trivy-cache"

# Imagens analisadas: a da API (build local) e a do Postgres (lida do compose)
imagemPostgres=$(docker compose config --images | grep '^postgres')
listaImagens=("nest-docker-app:local" "$imagemPostgres")

houveBloqueante=0
for imagemAlvo in "${listaImagens[@]}"; do
  printf '\n\e[1m=== %s ===\e[0m\n' "$imagemAlvo"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    -v "$VOLUME_CACHE_TRIVY":/root/.cache/trivy \
    "$IMAGEM_TRIVY" image --quiet --severity "$SEVERIDADES" --format json "$imagemAlvo" \
  | node -e '
    const relatorio = JSON.parse(require("fs").readFileSync(0));
    const ordem = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
    const contagem = Object.fromEntries(ordem.map((s) => [s, 0]));
    const achados = [];
    for (const resultado of relatorio.Results || []) {
      for (const vuln of resultado.Vulnerabilities || []) {
        contagem[vuln.Severity]++;
        achados.push({ ...vuln, alvo: resultado.Target, tipo: resultado.Type });
      }
    }
    const so = relatorio.Metadata?.OS ? `${relatorio.Metadata.OS.Family} ${relatorio.Metadata.OS.Name}` : "?";
    const resumoSeveridades = ordem.filter((s) => contagem[s]).map((s) => `${s}=${contagem[s]}`).join(" ");
    console.log(`SO: ${so} | ${resumoSeveridades || "nenhuma vulnerabilidade"}`);
    achados.sort((a, b) => ordem.indexOf(a.Severity) - ordem.indexOf(b.Severity));
    for (const v of achados) {
      const correcao = v.FixedVersion ? `corrigido em ${v.FixedVersion}` : "SEM correção";
      console.log(`  [${v.Severity}] ${v.VulnerabilityID} ${v.PkgName}@${v.InstalledVersion} (${v.tipo}) → ${correcao}`);
    }
    const bloqueantes = achados.filter((v) => ["CRITICAL", "HIGH"].includes(v.Severity) && v.FixedVersion).length;
    process.exitCode = bloqueantes > 0 ? 1 : 0;
    console.log(bloqueantes ? `\x1b[31m✘ ${bloqueantes} CRITICAL/HIGH com correção disponível\x1b[0m` : "\x1b[32m✔ nenhum CRITICAL/HIGH com correção disponível\x1b[0m");
  ' || houveBloqueante=1
done

exit $houveBloqueante
