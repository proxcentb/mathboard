{ pkgs, ... }:

{
  packages = [
    pkgs.git
    pkgs.nodejs_22
    pkgs.pnpm
  ];

  env.PNPM_HOME = "$PWD/.pnpm-home";

  processes.backend.exec = "pnpm dev:backend";
  processes.frontend.exec = "pnpm dev:frontend";

  enterShell = ''
    export PATH="$PNPM_HOME:$PATH"
    node --version
    pnpm --version
  '';
}
