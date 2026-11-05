# Third-party components and build inputs

This is a source-only avatar pilot. It includes no precompiled plugin, game assets, proprietary game binaries, BepInEx distribution, Microsoft SDK, or self-contained runtime.

The game plugin depends on the user's installed BepInEx, Harmony, Il2CppInterop, Unity and generated game interop assemblies. The installer reads those local references. It can download the official Microsoft .NET 10.0.403 SDK and required targeting packs into the user's local tool cache; those products retain their upstream licenses and notices.

Managed validation used the official Microsoft SDK, Roslyn and System.Management.Automation. Metadata validation inspected the user's supplied GSD1 assembly without executing native game code. These validation tools and the inspected assembly are not redistributed here.

The project continues the standalone source supplied by the user. This pilot source package contains the new avatar plugin and its dependencies and checks; it omits the prior ID-remapping plugin implementation. It does not include the old seed-tool executable or reference-regeneration tool recipe.
