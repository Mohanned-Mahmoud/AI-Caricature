/**
 * Editable Gemini prompt. Shared by the API route (server-side).
 */
export const PROMPT = `Transform the person in the uploaded photo into a highly stylized, exaggerated professional caricature, using the attached reference image ONLY as the visual style reference.

IMPORTANT:
Preserve the exact identity and recognizable facial characteristics of the person in the original photo. Keep their actual hairstyle, skin tone, face structure, eyebrows, eyes, nose, lips, smile, and distinctive facial features recognizable. Do NOT turn them into a different person.

HAIR & LIGHTING CONSISTENCY:
Regardless of camera flash reflection, harsh overhead room/ceiling lights, or overexposed highlights in the input photo, ALWAYS render full, solid, natural hair with rich volume, realistic texture, and the person's true hair color. NEVER leave any pure white, blank, transparent, bleached-out, or missing patches on the hair, forehead, or face. All hair must be fully painted and detailed.

CARICATURE STYLE:
Create a bold, exaggerated caricature with an oversized head and dramatically elongated neck. Exaggerate the person's real facial characteristics in a humorous but aesthetically pleasing way:

* noticeably enlarged ears
* enlarged and expressive eyes
* emphasized eyebrows
* slightly exaggerated nose
* fuller, more expressive lips
* exaggerated smile and cheeks
* elongated jaw and neck
* slightly enlarged forehead
* exaggerated facial proportions while keeping the person clearly recognizable
* preserve the person's natural hairstyle but make it more stylized and detailed

The exaggeration should feel intentional and professionally designed, like a premium digital caricature illustration, NOT like a random distortion or cheap cartoon filter.

RENDERING STYLE:
Highly detailed digital caricature illustration with a semi-realistic painterly finish.
Smooth but highly detailed skin.
Visible subtle skin texture and fine facial details.
Painterly brush strokes blended into realistic digital rendering.
Strong clean silhouettes.
Soft but defined facial shadows.
Crisp highlights on the forehead, nose, cheeks and lips.
Detailed individual hair strands.
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
Preserve the person's original clothing from the input photo and render it as detailed illustrated clothing.
Do not randomly change the outfit.

OVERALL RESULT:
The final image should look like a professionally painted, exaggerated celebrity/editorial caricature — humorous, stylish, highly detailed, expressive and polished.

Do not make it photorealistic.
Do not make it a flat cartoon.
Do not use anime style.
Do not use generic 3D animation style.
Do not simplify the facial features.
Do not add text, logos, watermarks, props, or extra people.

The uploaded reference image defines the desired ART DIRECTION, rendering quality, proportions, lighting, color treatment and caricature aesthetic.
The uploaded subject photo defines the PERSON, identity, facial features, clothing and expression.`;

