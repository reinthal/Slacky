# Slacky

Slacky is an unofficial Slack desktop application designed specifically to bring support for ARM64 Linux distributions such as Fedora Asahi Remix and Raspberry Pi machines. This project aims to provide a seamless and efficient Slack experience for ARM64 users who may not have access to an official Slack client.
Features

- Full support for ARM64 Linux distributions (Fedora Asahi Remix and Raspberry Pi OS, etc.)
- Regular updates to ensure compatibility and performance

## 📝 Planned Features
- Slacky is planned to be released on [Flathub](https://flathub.org/) [soon](https://github.com/andirsun/Slacky/issues/10). Stay tuned for installation instructions and package availability.
- Add automatic updates.

## 🛠️ Installation

1. Download the latest release from the [Releases page](https://github.com/andirsun/Slacky/releases).
2. Install the package and enjoy!

### ❄️ Nix / NixOS (x86_64 and arm64)

The repository ships a `flake.nix` that builds Slacky against the Electron from
nixpkgs.

Try it without installing:

```sh
nix run github:reinthal/Slacky
```

Install it into your user profile:

```sh
nix profile install github:reinthal/Slacky
```

Or add it to a flake-based NixOS configuration:

```nix
{
  inputs.slacky.url = "github:reinthal/Slacky";

  outputs = { nixpkgs, slacky, ... }: {
    nixosConfigurations.my-machine = nixpkgs.lib.nixosSystem {
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = [ slacky.packages.${pkgs.stdenv.hostPlatform.system}.default ];
        })
      ];
    };
  };
}
```

On a channel-based system without flakes (for example Nixbook), add this to
your `configuration.nix` and run `sudo nixos-rebuild switch`:

```nix
{ pkgs, ... }:
let
  slackySrc = builtins.fetchTarball "https://github.com/reinthal/Slacky/archive/main.tar.gz";
in
{
  environment.systemPackages = [ (pkgs.callPackage "${slackySrc}/nix/package.nix" { }) ];
}
```

Set `NIXOS_OZONE_WL=1` to run natively on Wayland.

## 💻 Development

1. Clone the repository
2. Install the required dependencies `npm install`
3. Start the development server: `npm run dev`
4. If you want to build and package the application, run: `npm run build && npm run pack`
5. To run the application in production mode, use: `npm run start`

When you change `package-lock.json`, update `npmDepsHash` in `nix/package.nix`
(run `nix build`; on a mismatch Nix prints the correct hash).

## 🤝 Contributing
I welcome contributions from the community! If you'd like to contribute, please feel free to submit a pull request (PR). Here's how you can get started:

1. Fork the repository
2. Create a new branch for your feature or bug fix
3. Commit your changes
4. Push the branch to your forked repository
5. Open a pull request in this repository

If you encounter any issues or bugs, please report them using the Issues tab on GitHub. Provide as much detail as possible to help us resolve the problem quickly.

## 🪪 License
Slacky is released under the MIT License. See the LICENSE file for more details.

## ✉️ Contact
For any questions or inquiries, please reach out through the Issues tab on GitHub or contact me directly at `hola@andersonlaverde.com`.
