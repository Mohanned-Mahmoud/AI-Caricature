/**
 * Editable Gemini / OpenAI prompt. Shared by the API route (server-side).
 */
export const PROMPT = `Transform the person in the uploaded photo into a highly stylized, exaggerated professional caricature, using the attached reference image ONLY as the visual style reference.

IMPORTANT:
Preserve the exact identity and recognizable facial characteristics of the person in the original photo. Keep their actual hairstyle (or hijab/headscarf), skin tone, face structure, eyebrows, eyes, nose, lips, smile, and distinctive facial features recognizable. Do NOT turn them into a different person.

HIJAB, HEADWEAR & COVERED EARS (STRICT ABSOLUTE REQUIREMENT):
* If the person in the photo is wearing a HIJAB, headscarf, shayla, veil, or turban:
  - NEVER show, draw, invent, or expose ears! Ears MUST remain 100% completely hidden and covered under the hijab at all times. It is strictly forbidden to draw ears on or protruding through a hijab.
  - NEVER show, invent, or expose hair if the person's hair is covered by the hijab in the original photo.
  - Faithfully preserve the exact color, fabric texture, style, wrap, and draping of the hijab.
  - The caricature neck elongation must remain properly covered by the hijab/neckline, keeping the modest coverage identical to the original photo.
* If the person's ears are covered by hair (such as long hair, curls, side volume, or bangs):
  - NEVER draw or expose ears over or through the hair. Keep ears completely covered by the hair exactly as in the photo.
* EAR EXAGGERATION RULE: ONLY draw or enlarge ears IF AND ONLY IF the person's ears are already clearly visible, exposed, and uncovered in the original photo. If ears are not visible in the input photo, DO NOT draw or invent them under any circumstances.

HAIR & LIGHTING CONSISTENCY:
For subjects with exposed hair: Regardless of camera flash reflection, harsh overhead room/ceiling lights, or overexposed highlights in the input photo, ALWAYS render full, solid, natural hair with rich volume, realistic texture, and the person's true hair color. NEVER leave any pure white, blank, transparent, bleached-out, or missing patches on the hair, forehead, or face. All hair must be fully painted and detailed. (If the person wears a hijab, keep the hijab fully opaque and detailed with no exposed hair).

CARICATURE STYLE:
Create a bold, exaggerated caricature with an oversized head and dramatically elongated neck. Exaggerate the person's real facial characteristics in a humorous but aesthetically pleasing way:

* enlarged and expressive eyes
* emphasized eyebrows
* slightly exaggerated nose
* fuller, more expressive lips
* exaggerated smile and cheeks
* elongated jaw and neck
* slightly enlarged forehead
* noticeably enlarged ears (ONLY IF the person's ears are already exposed and visible in the original photo — NEVER on hijab or ear-covering hair)
* exaggerated facial proportions while keeping the person clearly recognizable
* preserve the person's natural hairstyle (or hijab/headwear) but make it more stylized and detailed

The exaggeration should feel intentional and professionally designed, like a premium digital caricature illustration, NOT like a random distortion or cheap cartoon filter.

RENDERING STYLE:
Highly detailed digital caricature illustration with a semi-realistic painterly finish.
Smooth but highly detailed skin.
Visible subtle skin texture and fine facial details.
Painterly brush strokes blended into realistic digital rendering.
Strong clean silhouettes.
Soft but defined facial shadows.
Crisp highlights on the forehead, nose, cheeks and lips.
Detailed individual hair strands (or detailed fabric texture and smooth folds on hijab).
Rich dimensional shading.
Slightly glossy eyes and lips.
Professional character-illustration quality.
High-end editorial caricature aesthetic.

LIGHTING:
Soft cinematic studio lighting.
Warm highlights on the face.
Subtle rim light around the head and shoulders.
Deep but smooth shadows.
Strong facial dimensionality without harsh contrast.

BACKGROUND:
Use a simple artistic studio background similar to the reference image:
a muted desaturated green / teal background transitioning into a soft warm yellow-green glow behind the subject.
Subtle painterly texture.
Soft vignette.
No objects or distracting elements.

COMPOSITION:
Square 1:1 composition (1024x1024).
The subject must be fully centered horizontally and vertically within the square canvas.
Full head, neck, and upper torso (shoulders) must be completely visible — nothing cut off at any edge.
Leave generous padding on all four sides between the subject and the image border.
Face should dominate the composition with the characteristic oversized caricature head.
Clean professional portrait framing.

CLOTHING:
Preserve the person's original clothing and headwear from the input photo and render it as detailed illustrated clothing.
Do not randomly change the outfit or remove/modify head coverings.

OVERALL RESULT:
The final image should look like a professionally painted, exaggerated celebrity/editorial caricature — humorous, stylish, highly detailed, expressive and polished.

Do not make it photorealistic.
Do not make it a flat cartoon.
Do not use anime style.
Do not use generic 3D animation style.
Do not simplify the facial features.
Do not add text, logos, watermarks, props, or extra people.
Never draw ears on a hijab or over hair that covers the ears.

The uploaded reference image defines the desired ART DIRECTION, rendering quality, proportions, lighting, color treatment and caricature aesthetic.
The uploaded subject photo defines the PERSON, identity, facial features, clothing, headwear and expression.`;
