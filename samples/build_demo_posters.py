"""Render exact, code-native SVG demo posters to PNG for the real image pipeline."""
from pathlib import Path
import pymupdf

OUTPUT = Path(__file__).resolve().parents[1] / 'frontend' / 'public' / 'demo'


def poster(approved):
    range_value, price = ('400', '29,999') if approved else ('500', '24,999')
    claim = 'THOUGHTFULLY ELECTRIC.' if approved else 'BEST IN THE WORLD.'
    disclaimer = 'Actual range may vary.' if approved else 'Discover your next chapter.'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1250" viewBox="0 0 1000 1250">
    <defs><linearGradient id="paint" x2="0.2" y2="1"><stop stop-color="#eef4df"/><stop offset=".5" stop-color="#b4c8a2"/><stop offset="1" stop-color="#668066"/></linearGradient></defs>
    <rect width="1000" height="1250" fill="#19251f"/>
    <circle cx="900" cy="520" r="300" fill="none" stroke="#364b37"/>
    <circle cx="900" cy="520" r="410" fill="none" stroke="#2a3c2d"/>
    <g font-family="Arial, Helvetica, sans-serif"><text x="70" y="105" fill="#c5f277" font-size="48" font-weight="bold" letter-spacing="10">VOLT</text>
    <text x="930" y="94" fill="#c5f277" font-size="17" letter-spacing="4" text-anchor="end">ONE / ELECTRIC</text>
    <text x="70" y="260" fill="#f4f6ed" font-size="93" font-weight="bold" letter-spacing="-5">The everyday,</text>
    <text x="70" y="365" fill="#c5f277" font-size="109" letter-spacing="-5">electrified.</text>
    <text x="74" y="427" fill="#b0bda8" font-size="19" letter-spacing="4">{claim}</text>
    <path d="M0 820 L1000 570 L1000 795 L0 1045Z" fill="#24372a"/>
    <path d="M0 925 L1000 675" stroke="#a5bf89" stroke-width="2"/>
    <ellipse cx="512" cy="845" rx="380" ry="28" fill="#0c1711"/>
    <path d="M130 737 Q152 699 287 680 L373 593 Q404 573 529 579 Q616 580 697 657 L837 691 Q879 702 886 746 L879 797 Q849 820 758 815 L244 828 Q152 829 128 794Z" fill="#aebfa2" stroke="#bacbb0" stroke-width="3"/>
    <path d="M302 682 L391 603 Q443 592 520 599 L526 672Z" fill="#233c31"/>
    <path d="M543 599 Q619 607 678 666 L547 672Z" fill="#304a3c"/>
    <path d="M161 746 Q484 728 853 725" fill="none" stroke="#e3edd5" stroke-width="3"/>
    <path d="M804 722 L872 733" stroke="#e8ffcf" stroke-width="9"/>
    <path d="M139 749 L176 745" stroke="#db785f" stroke-width="7"/>
    <g fill="#17231c" stroke="#91a186" stroke-width="5"><circle cx="280" cy="799" r="57"/><circle cx="751" cy="777" r="57"/></g>
    <g fill="#96a88d" stroke="#465e49" stroke-width="10"><circle cx="280" cy="799" r="32"/><circle cx="751" cy="777" r="32"/></g>
    <rect x="70" y="940" width="860" height="1" fill="#52644a"/>
    <text x="70" y="1044" fill="#c5f277" font-size="79" font-weight="bold">{range_value}<tspan font-size="28" font-weight="normal"> km</tspan></text>
    <text x="73" y="1085" fill="#a4b39a" font-size="15" letter-spacing="2">DRIVING RANGE</text>
    <text x="562" y="1044" fill="#f4f6ed" font-size="70" font-weight="bold">${price}</text>
    <text x="566" y="1085" fill="#a4b39a" font-size="15" letter-spacing="2">STARTING PRICE</text>
    <text x="70" y="1173" fill="#d4dfc6" font-size="20">{disclaimer}</text>
    <text x="930" y="1173" fill="#c5f277" font-size="18" text-anchor="end">volt.auto</text>
    <text x="70" y="1223" fill="#82947b" font-size="12" letter-spacing="2">FICTIONAL BRAND / HACKATHON TEST CREATIVE</text></g></svg>'''


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for approved, filename in [(True, 'volt-approved'), (False, 'volt-violations')]:
        svg = poster(approved)
        (OUTPUT / f'{filename}.svg').write_text(svg, encoding='utf-8')
        with pymupdf.open(stream=svg.encode(), filetype='svg') as source:
            with pymupdf.open(stream=source.convert_to_pdf(), filetype='pdf') as pdf:
                pdf[0].get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False).save(str(OUTPUT / f'{filename}.png'))
        print(f'Created {filename}.svg and {filename}.png')
