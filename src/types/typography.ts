export type TextVariant =
  | 'displayLarge'
  | 'display'
  | 'headline'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'label';
export type TextWeight = 'bold' | 'semibold' | 'medium' | 'normal';
export type TextColor = 'primary' | 'secondary' | 'accent';

export const TextWeights: Record<TextWeight, string> = {
  bold: 'bold',
  semibold: 'semibold',
  medium: 'medium',
  normal: 'normal',
};

export const TextColors: Record<TextColor, TextColor> = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
};

// Map keys to classes
export const TEXT_WEIGHT_KEYS: Record<TextWeight, string> = {
  bold: 'font-bold',
  semibold: 'font-semibold',
  medium: 'font-medium',
  normal: 'font-normal',
};

export const TEXT_COLOR_KEYS: Record<TextColor, string> = {
  primary: 'text-text-primary',
  secondary: 'text-text-secondary',
  accent: 'text-accent',
};

export interface VariantConfig {
  size: string;
  defaultWeight: TextWeight;
  defaultColor: TextColor;
  defaultElement: React.ElementType;
  extraClasses?: string;
}

export const TextVariants: Record<TextVariant, VariantConfig> = {
  displayLarge: {
    size: 'text-5xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h1',
    extraClasses: 'text-shadow-shiny mb-4',
  },
  display: {
    size: 'text-3xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h1',
    extraClasses: 'text-shadow-shiny',
  },
  headline: {
    size: 'text-2xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h1', // check community page as this does not follow current style
    extraClasses: 'text-shadow-shiny',
  },
  title: {
    size: 'text-xl',
    defaultWeight: 'bold',
    defaultColor: 'primary',
    defaultElement: 'h2',
    extraClasses: 'text-shadow-shiny mb-6',
  },
  heading: {
    size: 'text-lg',
    defaultWeight: 'semibold',
    defaultColor: 'primary',
    defaultElement: 'h3',
  },
  subheading: {
    size: 'text-md',
    defaultWeight: 'semibold',
    defaultColor: 'primary',
    defaultElement: 'p',
  },
  body: {
    size: 'text-sm',
    defaultWeight: 'normal', //weight used for sm is all over the place
    defaultColor: 'secondary',
    defaultElement: 'p',
  },
  label: {
    size: 'text-xs',
    defaultWeight: 'medium', //CHECK WEIGHTS
    defaultColor: 'secondary',
    defaultElement: 'span',
  },
};
