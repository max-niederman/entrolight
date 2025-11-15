{
  description = "Entrolight";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            cudaSupport = true;
            allowUnfree = true;
          };
        };
        inherit (pkgs) lib;
        backend = pkgs.callPackage ./backend { };
      in
      {
        packages = {
          inherit backend;
        };

        devShell = pkgs.mkShell {
          buildInputs = with pkgs; [
            fastapi-cli
          ];

          inputsFrom = [
            backend
          ];

          LD_LIBRARY_PATH = lib.makeLibraryPath [
            "/run/opengl-driver"
          ];
        };
      }
    );

}
