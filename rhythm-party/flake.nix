{
  description = "rhythm-party — globally-synced rhythm game demo (Godot client + Miren backend)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Headless-friendly: `godot --headless` imports the project, compile-checks
        # GDScript, and runs the game logic with no display. The editor GUI is the
        # only thing we give up on this box.
        #
        # Web export (step 2) also runs headless. The templates are provided here;
        # we'll point Godot at $GODOT_EXPORT_TEMPLATES when we wire up the export.
        default = pkgs.mkShell {
          packages = [
            pkgs.godot                        # 4.4.1 editor binary; supports --headless
            pkgs.gdtoolkit_4                  # gdparse / gdlint / gdformat (Godot 4)
            pkgs.godot-export-templates-bin   # official export templates (incl. Web)
          ];

          GODOT_EXPORT_TEMPLATES = "${pkgs.godot-export-templates-bin}";

          shellHook = ''
            echo "rhythm-party devshell · $(godot --version 2>/dev/null)"
          '';
        };
      });
    };
}
