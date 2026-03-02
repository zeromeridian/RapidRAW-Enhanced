export type TextVariant =
  | 'displayLarge'
  | 'display'
  | 'headline'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'label'
  | 'small';
export type TextWeight = 'bold' | 'semibold' | 'medium' | 'normal';
export type TextColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'error';

export const TextWeights: Record<TextWeight, TextWeight> = {
  bold: 'bold',
  semibold: 'semibold',
  medium: 'medium',
  normal: 'normal',
};
export const TextColors: Record<TextColor, TextColor> = {
  primary: 'primary',
  secondary: 'secondary',
  accent: 'accent',
  info: 'info',
  success: 'success',
  error: 'error',
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
  info: 'text-blue-300',
  success: 'text-green-400',
  error: 'text-red-400',
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
    defaultElement: 'h2',
  },
  subheading: {
    size: 'text-md',
    defaultWeight: 'semibold',
    defaultColor: 'primary',
    defaultElement: 'p',
    extraClasses: 'mb-3',
  },
  body: {
    size: 'text-sm',
    defaultWeight: 'normal', //weight used for sm is all over the place
    defaultColor: 'secondary',
    defaultElement: 'p',
  },
  label: {
    size: 'text-sm',
    defaultWeight: 'medium',
    defaultColor: 'secondary',
    defaultElement: 'span',
  },
  small: {
    size: 'text-xs',
    defaultWeight: 'normal', //CHECK WEIGHTS
    defaultColor: 'secondary',
    defaultElement: 'p',
  },
};
