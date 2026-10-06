import { mount } from "svelte";
import CodecPlayer from "./CodecPlayer.svelte";

// Standalone, a dropped meeting is offered to the site's upload service; where
// there is none (the dev server) it just plays here.
mount(CodecPlayer, { target: document.getElementById("app")!, props: { uploads: true } });
