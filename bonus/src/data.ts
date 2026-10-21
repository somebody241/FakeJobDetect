import raw from '../../data.csv?raw';
import { parseReviews } from './csv.ts';
import { postingFromReview, scalePosting } from './model.ts';

export const reviews = parseReviews(raw);
export const scaledReviews = reviews.map((review) => scalePosting(postingFromReview(review)));
