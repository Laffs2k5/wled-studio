# Your effects

Put your own effects here, one WLED usermod per folder, for example `effects/my_fx/` with a
`library.json` and the `.cpp` file. Or point `WLEDSTUDIO_EFFECTS_DIR` at your own (private)
repository of usermods.

Everything in this folder except this README is ignored by git, so private effects don't end up in
this repository.

Each usermod's `library.json` needs a `"name"` that starts with `wled-`, or WLED's build won't
treat it as a module. See `examples/usermods/studio_example_fx` in wled-studio-builder for a
working example: an effect registered at a fixed effect id.
