{
  lib,
  buildNpmPackage,
  nodejs_22,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  electron_42 ? null,
  electron,
}:

let
  # package-lock.json pins Electron 42; fall back to the default Electron on
  # nixpkgs revisions that no longer carry electron_42.
  electronPkg =
    if (builtins.tryEval electron_42).success && electron_42 != null then electron_42 else electron;
  packageJson = lib.importJSON ../package.json;
in
buildNpmPackage {
  pname = "slacky";
  inherit (packageJson) version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../.swcrc
      ../src
      ../build/icons/icon.png
    ];
  };

  nodejs = nodejs_22;

  # Update with `nix build` after changing package-lock.json: Nix prints the
  # expected hash on mismatch.
  npmDepsHash = "sha256-UAnIaAh8UPciwrOP/06KQPj1sb/ItkByQKgJxGorNSw=";

  # Electron comes from nixpkgs; never let npm download its own binary.
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  # Only the TypeScript compile step is needed, so skip every dependency's
  # install script (electron, electron-builder, swc, ...).
  npmRebuildFlags = [ "--ignore-scripts" ];
  # The lockfile resolves chokidar@3 (via nodemon) while @swc/cli declares an
  # optional peer on chokidar@5; npm tries to look that up online, which the
  # offline Nix build can't do. Ignoring peer resolution keeps the locked tree.
  npmFlags = [ "--legacy-peer-deps" ];

  # `npm run build` -> swc src -d dist/app
  npmBuildScript = "build";

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/slacky
    cp -r package.json dist $out/share/slacky/

    install -Dm644 build/icons/icon.png $out/share/icons/hicolor/512x512/apps/slacky.png

    makeWrapper ${lib.getExe electronPkg} $out/bin/slacky \
      --add-flags $out/share/slacky \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "slacky";
      desktopName = "Slacky";
      genericName = "Slack Client";
      comment = "Unofficial Slack desktop client";
      exec = "slacky %U";
      icon = "slacky";
      categories = [
        "Network"
        "InstantMessaging"
      ];
      mimeTypes = [ "x-scheme-handler/slack" ];
      startupWMClass = "slacky";
    })
  ];

  meta = {
    description = "Unofficial Slack desktop client for Linux";
    homepage = "https://github.com/andirsun/Slacky";
    license = lib.licenses.mit;
    mainProgram = "slacky";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
