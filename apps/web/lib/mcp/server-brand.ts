// BI-20397491 — what the MCP handshake says about this server beyond its name.
//
// A client that draws a tile per connector had nothing to draw for DPF: the
// handshake carried a name and a version only. MCP 2025-11-25 (SEP-973) lets a
// server publish `icons` and `websiteUrl` on its Implementation, and this is
// the one home for what DPF publishes there.
//
// The icons are inline data URIs, not URLs. An air-gapped install still shows
// them, nothing is fetched from another host, and the portal's own logo paths
// sit behind sign-in, where a client has no session. They ride on every
// connection, so they are small: one 96px PNG (the format every icon-rendering
// client must support) and the same mark as SVG.
//
// The mark is the emblem of the platform wordmark
// (apps/web/public/logos/open-digital-product-factory-logo.svg): its gradient
// square and lettering, moved into a 32x32 box. The files are
// apps/web/public/logos/dpf-mark.svg and dpf-mark-96.png; the constants below
// are those files in base64. server-brand.test.ts fails if the wordmark, the
// files and these constants ever disagree.

export type McpIcon = {
  src: string;
  mimeType: "image/png" | "image/svg+xml";
  sizes: string[];
};

export const MCP_SERVER_WEBSITE_URL = "https://opendigitalproductfactory.com/";

/** The protocol revision that introduced `icons` and `websiteUrl` on Implementation. */
const SERVER_BRAND_SINCE = "2025-11-25";

/**
 * Whether the handshake may carry the mark and website for this negotiated
 * revision. Earlier revisions have no such fields, and a strictly typed client
 * on one of them is owed a result its schema knows (the same reason
 * `capabilities.tasks` is revision-gated). Revisions are ISO dates, so "since"
 * is a string comparison and a later revision keeps the fields.
 */
export function advertisesServerBrand(negotiatedProtocolVersion: string): boolean {
  return negotiatedProtocolVersion >= SERVER_BRAND_SINCE;
}

const MARK_PNG_96_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAC5VBMVEVMaXFghdpjht1hhdtnhuFghdtqh+Rmht9kht5vieto" +
  "h+JagtNrh+Vyie1YgtFihdxriOVxiextiOhdg9V0ie9ZgtJWgc9ph+Nzie5fg9lfg9hriOZsiOdeg9duielcgtR1ifBXgdFW" +
  "gdBqh+Vph+R1ie9nhuJoh+Nghdlgg9ljhtxihdtVgc5siOZeg9h1ifFVgc1dg9dtiOduiOluiOhcg9Rcg9V2ivFUgM1XgtFz" +
  "ie9XgdB2ivJUgMxWgc5TgMp3ivP6+/14ivNSgMpTgMx3ivKgs+yds+p7lOmasOmgse53lOZ1ld+Kpt+cs+iPpOuQpe18mOWW" +
  "r+X5+v3r8PpVqv+LoeyOp+Rni9pdhtZlh+CWr+Nlhd+ese2Rpu+Lp+GkuOuMp+O9yvZ8lOqNoe28yfRmi9mtvu6YsOhpjNzb" +
  "4vdihN+LpuCesezx9Ptoi9vm7PlxjuJ6lOe4x/KpveuOqOV9lOtmht/k6fnQ2fbk6vl4luFnh+KTqemUr+NihNm6yfBphuV1" +
  "leBuf91kht1ghNtff9dnidxmhuG/zPBohuNjhd1oieNph+RmhuJfhNtphuONpua0wvHo7fnd5PhykuDD0fF3i/Lv8vu2x+70" +
  "9/x1ifF4ifNriOTt8fp7g/Z1i/R3iPJ2ivRtj9t4ivJMf794ivN4i/V/nt8/f794i/RRgMpRgcx5i/RRgMpTgMt5ivVUgMpT" +
  "gcpTgctXf89RgMtSgcn3+PyktuyMpOeFoOP7+//U3vbr7/vy9Puvwe3S3fRhhNtpieHf5vdihNumt+9sieO8yvC1xfFihNzQ" +
  "2/Rkh9yIouZpjNtihdxjhNyKpOZhhdtkg+Bqh+NqjteMpuWGn+eJpeHAzvCou+xhhNqmu+vG0vO/zPHl6vl9l+jJ1PRghdiv" +
  "we5qhuNkh9lqiON2ivKHn+pxk9p3ivJ/f/9mh954i/VSfchSgMvM1/J8md9RgMlSgctVgcr////9/f7+/v9e6UPtAAAA9HRS" +
  "TlMA5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5v7m5ubm" +
  "7+/o7u7oB+3v7Ozp7v78A+vt5xO37lDu7O3w7fPo6/Pn8e7n+T7t7v3n++jo8/Ht6cP69/rpse3uYPOU6R7D1SDnifTli13U" +
  "wrvh7fL7+ej14fzz/RJO5vwdXTyU6LgU5YfrBMBSu7CN1rRhluEgxbn+8Ozr/vj7/fL44eb6lvDn9PKz9+br57Ll7JVCuejs" +
  "6+z18OHw9fT66fbm8rjn5tPq6dQC5sJBs/fqw7M/qZopMQAAAAlwSFlzAAAhOAAAITgBRZYxYAAABPRJREFUaN7tmmlUVVUU" +
  "x2UmrCCJnDLU5rKywbLURC3URIqQjKEkyyAQFSGHBAdwAgdI05xyrigVUpPmwQa1UhttnkzLodmAz72z9zn3vb3PA5ey7zfO" +
  "t7Pu5fe769y9/+eud2jVqmW0DBfGi1u3ba7Z3rNn9+7dut16nmd07dqrS5ebz/aMmJiY1p4RG9vjxujo6Gs7dbq6Q4f27S+/" +
  "LCAgYOesivemzT45/blNf/Xte1ufPqfKDwkJCQoKunJ/RkrT/D93DGgOPzIycmZuE/iE6gHN5V8RGDgvoTH+07US/MDwtNRG" +
  "+P/K8MPDJ/o1JNRK8cPC0vytUrUcPyxsrs3/T5IfHPyZVf87RPnBC3k/bJLlXxKRwQQnhPkRRSx/pPkR5aVEsFWaf2nb+USw" +
  "TZzfdgYRbBbnX3SICGrE+aELiGC7OD+0kgjk+aEXUoE8/0wicIHPBPJ8KnCBH0UF8nwqcIFPBS7wO3KBNJ8LxPlXUYE8/3wi" +
  "cIHPBPL864jA8L+YOjUdx93pXx0l/JLs7MF6ZO9d4uXvysvLuw/HHTCOIL8NEZjnH1rnO8YsrfI+fyK5NO6bd/TzD6ljYxTy" +
  "mUCvz1B+998bzPoksiuPJeH62ALkU4FZf0tQt/ofvf6J1pV8WH9bgPwbiMC8X1tQt3oJvl8QNAzzjGUNeOV1eL9+BMC/ngug" +
  "flDwsKd+NlQVLsY/eBvrBwT9oH7ys16CK8WqflBwp2/9AP8CJsD6NAKon4PL8VEPQH0aAdTPK/Vq9rOqT0fA+Eyg6380Ckx9" +
  "Lofph1D/A1Gg63Oymv2o6t8IOP8MIjD9pQWm/g+PA+oc1V8oMPWfpWYrVH+NR4HF5wLsXyMw/VUI88dV/xoB9tfLalb/q6d/" +
  "HQHjM4HOhxEocPq3BObfqXzQAt2/e9RsmcoHI+B8KjD5g4J7vf2brObTVf6gQPMjJqnZEyp/BsGfvH+PGg95xgTNP4cLIN+M" +
  "wMm3YWr+tco3R6D6twDuK1D5Noi3geZzAeanFnjzE97yUpWfIHgtyTO+jM+B2+p/UvnJBSM1nwl0Pj8A94z15vObar5b5fNA" +
  "q8cLIJ8tgeafRQQm/7XA4X8EDfWW6l9LMPkpyH9/AsVnAr2/aIGzvxyA+WDVv0yQvAj5USi4y7d+gE8FZv9CwT5n/yqD+RTV" +
  "v/E+8DdyFg0x+5cWWHwqMPvjcLj7EcOfAlW6GPIBBP3s/dERMH47IjD7rxEgfw5Wyy+QDyiw918j4HwuwHzTAuS/+i7MVuRD" +
  "PhgB39+1wOIzgc5PFBRmZmZmlU3SK56J+aMF1vfDgyiw+LcQgcnn4faO9r3ONxTY3ydaYPHPJQKTz5ag4Yffdb6hwP7+QcH9" +
  "Fp8JdH4+yj8dip3vHy2wvq8moMDiU4HJZx9B8pic6Z/4fL+hwOK38QoonwpO+/vQ7i/Dv5gK5PlU4AK/MxXI86nABT4VuMC/" +
  "hghc4HOBOP8mKpDnU8G38vwniWCWOL/3b0RQIc7vvZEIPhXn376eCKaJ8+PWEsHsj6X5z6yhP15/IMyP28J+fc8Q5vdfxQQp" +
  "M2X5z1sHdrmi/P7r7EOceZL8Z/0dc6XJ8V/wexiYOlGK/8dK/0eBqWlCz7+y0cPSuSLrn9DEeWzuwmbX57qmD5RTMorKm5EP" +
  "W1YdP/mheOn8GZ8vqDzl/eXYxvVr17T8w0LLcGP8Dw2seBAtGvzTAAAAAElFTkSuQmCC";

const MARK_SVG_BASE64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBo" +
  "ZWlnaHQ9IjMyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZHBmLWdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4" +
  "Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojNGY4MGM3O3N0" +
  "b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3YzhjZjg7c3Rv" +
  "cC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSIyIiB5PSIyIiB3aWR0" +
  "aD0iMjgiIGhlaWdodD0iMjgiIHJ4PSI2IiBmaWxsPSJ1cmwoI2RwZi1ncmFkKSIgb3BhY2l0eT0iMC45Ii8+CiAgPHRleHQg" +
  "eD0iMTYiIHk9IjIxIiBmb250LWZhbWlseT0iSW50ZXIsIHN5c3RlbS11aSwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMiIg" +
  "Zm9udC13ZWlnaHQ9IjcwMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkRQRjwvdGV4dD4KPC9zdmc+Cg==";

export const MCP_SERVER_ICONS: readonly McpIcon[] = Object.freeze([
  { src: `data:image/png;base64,${MARK_PNG_96_BASE64}`, mimeType: "image/png", sizes: ["96x96"] },
  { src: `data:image/svg+xml;base64,${MARK_SVG_BASE64}`, mimeType: "image/svg+xml", sizes: ["any"] },
]);
