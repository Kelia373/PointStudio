# 第三方许可与归属

本仓库随应用分发下列第三方开源素材。**改动、替换或新增素材时，同步更新本文件**；
打包后应在「设置 → 关于」里能查到同一份内容。

---

## LobeHub Icons（@lobehub/icons-static-svg）

- 用途：`src/renderer/src/assets/providers/*.svg`（24×24 厂商品牌图标，构建期以 `?raw` 内联）
- 上游：https://github.com/lobehub/lobe-icons
- 版本：1.106.0（只取静态 SVG，不作为运行时依赖）
- 许可：MIT

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`paseo.svg`、`continue.svg`、`custom.svg` 为本项目自绘的几何兜底图标，随本仓库许可发布。

---

## Lucide Icons

- 用途：`src/renderer/src/assets/icons/*.svg`（24×24 线性图标）
- 上游：https://github.com/lucide-icons/lucide
- 许可：ISC（其中部分图标源自 Feather，按 MIT）

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle,
arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left,
arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right,
arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right,
chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle,
clipboard, clock, code, columns, command, compass, corner-down-left,
corner-down-right, corner-left-down, corner-left-up, corner-right-down,
corner-right-up, corner-up-left, corner-up-right, crosshair, database,
divide-circle, divide-square, dollar-sign, download, external-link, feather,
frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy,
link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2,
minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical,
move, music, navigation-2, navigation, octagon, pause-circle, percent,
plus-circle, plus-square, plus, power, radio, rss, search, server, share,
shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target,
terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon,
x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Microsoft Fluent Emoji

- 用途：`src/renderer/src/assets/avatars/fluent-3d/*.webp`
  （从上游 3D PNG 精选 26 张，等比缩放至 128×128 并转 WebP，图形本身未改动）
- 上游：https://github.com/microsoft/fluentui-emoji
- 许可：MIT

```text
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 内置字体（17 款，SIL Open Font License 1.1）

- 用途：`src/renderer/src/assets/fonts/*.woff2`，由 `styles/fonts.css` 的 `@font-face` 映射为
  「设置 → 字体与字号」里的全局字体（`--font-ui`）与代码字体（`--mono-code`）。
  文件为上游的 latin / latin-ext 子集裁剪（`unicode-range` 由 Google Fonts 子集切分给定），
  **字形本身未改动**，因此未产生 Modified Version，未涉及保留字体名称争议。
- 上游：Google Fonts（https://fonts.google.com），逐款源码仓库见下表。
- 许可：SIL Open Font License 1.1，17 款共用文末同一份全文；各款版权声明逐条列在下表。
- 新增字体时必须同时更新本表与 `lib/typography.ts` 注册表（`typographyCss.test.ts` 会校验）。

| 字体 | 分类 | 版权声明 | 上游仓库 |
| --- | --- | --- | --- |
| Geist | 正文 | Copyright 2024 The Geist Project Authors | https://github.com/vercel/geist-font |
| Geist Mono | 代码 | Copyright 2026 The Geist Project Authors | https://github.com/vercel/geist-font |
| Inter | 正文 | Copyright 2020 The Inter Project Authors | https://github.com/rsms/inter |
| Manrope | 正文 | Copyright 2018 The Manrope Project Authors | https://github.com/googlefonts/manrope |
| Plus Jakarta Sans | 正文 | Copyright 2020 The Plus Jakarta Sans Project Authors | https://github.com/tokotype/PlusJakartaSans |
| IBM Plex Sans | 正文 | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" | https://github.com/IBM/plex |
| IBM Plex Mono | 代码 | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" | https://github.com/IBM/plex |
| Space Grotesk | 正文 | Copyright 2020 The Space Grotesk Project Authors | https://github.com/floriankarsten/space-grotesk |
| DM Sans | 正文 | Copyright 2014 The DM Sans Project Authors | https://github.com/googlefonts/dm-fonts |
| Figtree | 正文 | Copyright 2022 The Figtree Project Authors | https://github.com/erikdkennedy/figtree |
| JetBrains Mono | 代码 | Copyright 2020 The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono |
| Fira Code | 代码 | Copyright 2014-2020 The Fira Code Project Authors | https://github.com/tonsky/FiraCode |
| Source Code Pro | 代码 | Copyright 2010, 2012 Adobe Systems Incorporated, with Reserved Font Name 'Source'. All Rights Reserved. | https://github.com/adobe-fonts/source-code-pro |
| Red Hat Mono | 代码 | Copyright 2024 The Red Hat Project Authors | https://github.com/RedHatOfficial/RedHatFont |
| Martian Mono | 代码 | Copyright 2021 The Martian Mono Project Authors | https://github.com/evilmartians/mono |
| Inconsolata | 代码 | Copyright 2006 The Inconsolata Project Authors | https://github.com/googlefonts/Inconsolata |
| Azeret Mono | 代码 | Copyright 2021 The Azeret Project Authors | https://github.com/displaay/azeret |

```text
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)
Copyright 2026 The Geist Project Authors (https://github.com/vercel/geist-font)
Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)
Copyright 2018 The Manrope Project Authors (https://github.com/googlefonts/manrope)
Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)
Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)
Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree)
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
Copyright 2014-2020 The Fira Code Project Authors (https://github.com/tonsky/FiraCode)
Copyright 2010, 2012 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'. All Rights Reserved. Source is a trademark of Adobe Systems Incorporated in the United States and/or other countries.
Copyright 2024 The Red Hat Project Authors (https://github.com/RedHatOfficial/RedHatFont)
Copyright 2021 The Martian Mono Project Authors (https://github.com/evilmartians/mono)
Copyright 2006 The Inconsolata Project Authors
Copyright 2021 The Azeret Project Authors (https://github.com/displaay/azeret)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org
```


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
